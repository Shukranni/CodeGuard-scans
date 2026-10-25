import io
import os
import shutil
import tempfile
import zipfile

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import Project


User = get_user_model()


def make_archive():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('src/nested folder/app.js', 'const value = 1;\n')
        archive.writestr('assets/logo.png', b'\x89PNG\r\n\x1a\n')
        archive.writestr('assets/unknown.dat', b'\x00\x01\x02')
    return buffer.getvalue()


class ProjectFileExplorerApiTests(APITestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='codeguard_explorer_test_')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)

        self.user = User.objects.create_user(username='explorer-user', password='password')
        self.client.force_authenticate(self.user)
        self.project = Project.objects.create(
            owner=self.user,
            name='explorer.zip',
            zip_file=ContentFile(make_archive(), name='explorer.zip'),
        )
        self.file_url = f'/api/projects/{self.project.pk}/file/'
        self.tree_url = f'/api/projects/{self.project.pk}/filetree/'

    def test_file_tree_lists_unique_normalized_relative_paths(self):
        with zipfile.ZipFile(self.project.zip_file.path, 'a') as archive:
            archive.writestr('src\\nested folder\\app.js', 'duplicate entry')

        response = self.client.get(self.tree_url)

        self.assertEqual(response.status_code, 200)
        matching_files = [
            item for item in response.data['files']
            if item['path'] == 'src/nested folder/app.js'
        ]
        self.assertEqual(len(matching_files), 1)
        self.assertEqual(matching_files[0]['name'], 'app.js')

    def test_file_content_accepts_windows_separators_and_spaces(self):
        response = self.client.get(
            self.file_url,
            {'path': r'src\nested folder\app.js'},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['path'], 'src/nested folder/app.js')
        self.assertEqual(response.data['content'], 'const value = 1;\n')

    def test_file_content_rejects_absolute_and_traversal_paths(self):
        paths_and_statuses = (
            ('/src/nested folder/app.js', 400),
            (r'C:\src\nested folder\app.js', 400),
            ('../outside.txt', 403),
            ('src/../../outside.txt', 403),
        )

        for path, expected_status in paths_and_statuses:
            with self.subTest(path=path):
                response = self.client.get(self.file_url, {'path': path})
                self.assertEqual(response.status_code, expected_status)

        encoded_response = self.client.get(
            f'{self.file_url}?path=%2e%2e%2foutside.txt'
        )
        self.assertEqual(encoded_response.status_code, 403)

    def test_file_content_distinguishes_missing_and_binary_files(self):
        missing = self.client.get(self.file_url, {'path': 'missing.js'})
        binary = self.client.get(self.file_url, {'path': 'assets/logo.png'})
        unknown_binary = self.client.get(self.file_url, {'path': 'assets/unknown.dat'})

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(binary.status_code, 422)
        self.assertEqual(unknown_binary.status_code, 422)

    def test_file_tree_is_private_to_the_project_owner(self):
        other_user = User.objects.create_user(username='another-user', password='password')
        self.client.force_authenticate(other_user)

        response = self.client.get(self.tree_url)

        self.assertEqual(response.status_code, 404)

    def test_missing_archive_returns_not_found(self):
        os.remove(self.project.zip_file.path)

        tree_response = self.client.get(self.tree_url)
        file_response = self.client.get(self.file_url, {'path': 'src/nested folder/app.js'})

        self.assertEqual(tree_response.status_code, 404)
        self.assertEqual(file_response.status_code, 404)
