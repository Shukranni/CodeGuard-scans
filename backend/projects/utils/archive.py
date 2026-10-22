"""
Access an uploaded project archive as a *local* file.

The ``Project.zip_file`` field is a ``FileField``.  Depending on the
configured storage backend the file either lives on the local disk
(``FileSystemStorage`` — development) or in an object store (S3 / Cloudflare
R2 / Backblaze B2 — production, because free hosts have an ephemeral disk).

Every consumer of the archive (validation, extraction, the scan worker, the
source-context reader) needs a real filesystem path, so this module provides
one helper that works with both:

    with local_archive_path(project) as path:
        ...

With local storage the existing file is used as-is.  With remote storage the
object is streamed into a temporary file that is removed again afterwards.

A missing archive raises :class:`InvalidZipArchive` so every caller reports
the problem the same way.
"""
import os
import shutil
import tempfile
from contextlib import contextmanager

from projects.utils.zip_validator import InvalidZipArchive

# Copy remote archives to disk in 1 MB chunks.
COPY_CHUNK_SIZE = 1024 * 1024

MISSING_ARCHIVE_MESSAGE = 'Uploaded archive could not be found on the server.'


@contextmanager
def local_archive_path(project):
    """
    Yield a local filesystem path to the project's ZIP archive.

    The path is only valid inside the ``with`` block.  When the archive lives
    in remote storage the file is downloaded into a temporary location and
    deleted when the block exits.
    """
    if project is None:
        raise InvalidZipArchive(MISSING_ARCHIVE_MESSAGE)

    field = project.zip_file

    # A project whose upload never landed (or was cleared) has no file.
    if not getattr(field, 'name', None):
        raise InvalidZipArchive(MISSING_ARCHIVE_MESSAGE)

    # Fast path — the file is already on the local disk.
    local_path = None
    try:
        local_path = field.path
    except (NotImplementedError, ValueError, TypeError, AttributeError, OSError):
        # Remote storages have no local path.
        local_path = None

    if local_path:
        if not os.path.isfile(local_path):
            # The object is gone (e.g. the ephemeral disk of a free host was
            # wiped between the upload and the scan).
            raise InvalidZipArchive(MISSING_ARCHIVE_MESSAGE)
        yield local_path
        return

    # Slow path — stream the object into a temporary file.
    handle = tempfile.NamedTemporaryFile(prefix='codeguard_zip_', suffix='.zip', delete=False)
    temp_path = handle.name
    handle.close()

    try:
        try:
            with field.open('rb') as source:
                with open(temp_path, 'wb') as destination:
                    shutil.copyfileobj(source, destination, length=COPY_CHUNK_SIZE)
        except Exception as exc:
            raise InvalidZipArchive(MISSING_ARCHIVE_MESSAGE) from exc

        yield temp_path
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
