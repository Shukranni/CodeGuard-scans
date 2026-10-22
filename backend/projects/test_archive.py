"""
Tests for `projects.utils.archive.local_archive_path`.

The helper is the single point of access to an uploaded archive, so both
storage backends it must handle are covered here:

  * local storage   — the file is already on disk and is used as-is;
  * remote storage  — no local path exists, the object is copied into a
                      temporary file that is deleted afterwards.

Run with:  python manage.py test projects
"""
import os
import zipfile
from io import BytesIO

from django.core.files import File
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.test import TestCase

from .models import Project
from .utils.archive import local_archive_path
from .utils.zip_validator import InvalidZipArchive


def _sample_zip_bytes():
    """Build a small but valid ZIP in memory."""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('hello.js', 'console.log("hi");\n')
    return buffer.getvalue()


class NoPathStorage(FileSystemStorage):
    """
    Mimics an S3/R2 storage: the file can be opened and read, but there is no
    local filesystem path.  (A real remote storage implements `_open` with an
    HTTP GET and never consults `path`.)
    """

    def path(self, name):
        raise NotImplementedError('This storage has no local file system path.')

    def _open(self, name, mode='rb'):
        return File(open(os.path.join(self.location, name), mode))


def make_project(name='proj.zip', zip_bytes=None):
    zip_bytes = zip_bytes if zip_bytes is not None else _sample_zip_bytes()
    project = Project(name=name, owner=None)
    project.save()
    project.zip_file.save(name, ContentFile(zip_bytes), save=True)
    return project


class LocalArchivePathTests(TestCase):

    def setUp(self):
        self.project = make_project()
        self.addCleanup(self._remove_uploaded_file)

    def _remove_uploaded_file(self):
        try:
            if self.project.zip_file.name:
                self.project.zip_file.delete(save=False)
        except Exception:
            pass

    def test_local_storage_yields_the_existing_path(self):
        with local_archive_path(self.project) as path:
            self.assertEqual(path, self.project.zip_file.path)
            self.assertTrue(os.path.isfile(path))
            # The context manager must NOT have copied or deleted anything.
            self.assertTrue(os.path.isfile(self.project.zip_file.path))

    def test_remote_storage_copies_to_a_temp_file_and_cleans_up(self):
        self.project.zip_file.storage = NoPathStorage()

        with local_archive_path(self.project) as path:
            copied = path
            self.assertTrue(os.path.isfile(copied))
            with open(copied, 'rb') as handle:
                self.assertEqual(handle.read(), _sample_zip_bytes())
            # It really is a temporary copy, not the stored object itself.
            stored = os.path.join(
                self.project.zip_file.storage.location, self.project.zip_file.name
            )
            self.assertNotEqual(copied, stored)
            self.assertTrue(os.path.isfile(stored))

        self.assertFalse(os.path.exists(copied), 'temporary copy must be deleted')

    def test_remote_storage_result_is_a_readable_zip(self):
        self.project.zip_file.storage = NoPathStorage()

        with local_archive_path(self.project) as path:
            self.assertTrue(zipfile.is_zipfile(path))

    def test_missing_archive_raises_invalid_zip_archive(self):
        # The realistic failure on a free host: the row still references the
        # file, but the ephemeral disk no longer holds it.
        os.remove(self.project.zip_file.path)
        self.assertFalse(os.path.exists(self.project.zip_file.path))

        with self.assertRaises(InvalidZipArchive):
            with local_archive_path(self.project) as _:
                pass

    def test_project_without_upload_raises_invalid_zip_archive(self):
        bare = Project(name='no-upload.zip', owner=None)
        bare.save()
        with self.assertRaises(InvalidZipArchive):
            with local_archive_path(bare) as _:
                pass

    def test_missing_project_raises_invalid_zip_archive(self):
        with self.assertRaises(InvalidZipArchive):
            with local_archive_path(None) as _:
                pass
