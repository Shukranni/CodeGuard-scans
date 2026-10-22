"""
Tests for the GitHub repository import (``POST /api/projects/github/``).

Covered:
  * URL parsing — the accepted URL forms and, more importantly, the
    rejection of everything that is not a github.com repository (the
    endpoint must not be usable as an SSRF proxy),
  * archive building — excluded directories, relative entry names and
    empty repositories,
  * the endpoint itself — project creation, the validation payload, owner
    isolation and the guarantee that the access token is never stored and
    never echoed back to the client.

Run with:  python manage.py test projects
"""
import json
import os
import shutil
import tempfile
import zipfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework import status as http_status
from rest_framework.test import APITestCase

from projects.models import Project
from projects.utils.github import (
    GitHubRepositoryError,
    build_source_archive,
    parse_repository_url,
)

User = get_user_model()

SECRET_TOKEN = 'ghp_thisisasecrettoken'


class RepositoryUrlParsingTests(SimpleTestCase):
    """The URL the user types is parsed, never used as-is."""

    def test_accepts_the_common_url_forms(self):
        cases = {
            'https://github.com/owner/repo': ('owner', 'repo', None),
            'https://github.com/owner/repo.git': ('owner', 'repo', None),
            'http://github.com/owner/repo': ('owner', 'repo', None),
            'https://www.github.com/owner/repo/': ('owner', 'repo', None),
            'https://github.com/owner/repo/tree/main': ('owner', 'repo', 'main'),
            # Only the first segment after "tree"/"blob" is the branch — the
            # rest of the URL is a path inside the repository.
            'https://github.com/owner/repo/blob/main/src/app.js': ('owner', 'repo', 'main'),
            'git@github.com:owner/repo.git': ('owner', 'repo', None),
            'github.com/owner/repo': ('owner', 'repo', None),
            'owner/repo': ('owner', 'repo', None),
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                parsed = parse_repository_url(url)
                self.assertEqual(
                    (parsed['owner'], parsed['repo'], parsed['ref']),
                    expected,
                )

    def test_rejects_hosts_other_than_github(self):
        for url in (
            'https://gitlab.com/owner/repo',
            'https://evil.example.com/owner/repo',
            'https://github.com.evil.example/owner/repo',
            'https://raw.githubusercontent.com/owner/repo',
            'https://api.github.com/repos/owner/repo',
        ):
            with self.subTest(url=url):
                with self.assertRaises(GitHubRepositoryError):
                    parse_repository_url(url)

    def test_rejects_malformed_input(self):
        for url in ('', '   ', None, 'https://github.com/owner', 'https://github.com/'):
            with self.subTest(url=url):
                with self.assertRaises(GitHubRepositoryError):
                    parse_repository_url(url)

    def test_rejects_traversal_in_the_owner_or_repository_name(self):
        for url in (
            'https://github.com/../../etc/passwd',
            'https://github.com/owner/..',
            'https://github.com/owner/..%2F..%2Fetc',
        ):
            with self.subTest(url=url):
                with self.assertRaises(GitHubRepositoryError):
                    parse_repository_url(url)


class SourceArchiveTests(SimpleTestCase):
    """The repository is turned into a ZIP that the scanner can consume."""

    def setUp(self):
        self.workdir = tempfile.mkdtemp(prefix='codeguard_github_test_')
        self.addCleanup(shutil.rmtree, self.workdir, ignore_errors=True)
        self.output_dir = tempfile.mkdtemp(prefix='codeguard_github_out_')
        self.addCleanup(shutil.rmtree, self.output_dir, ignore_errors=True)

    def _write(self, relative, content='content'):
        path = os.path.join(self.workdir, relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(content)

    def test_archive_uses_relative_paths_and_skips_noise(self):
        self._write('src/app.js', 'console.log(1);')
        self._write('package.json', '{}')
        self._write('.git/config', 'secret')
        self._write('node_modules/left-pad/index.js', 'noise')

        archive_path = os.path.join(self.output_dir, 'repo.zip')
        build_source_archive(self.workdir, archive_path)

        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())

        self.assertIn('src/app.js', names)
        self.assertIn('package.json', names)
        self.assertNotIn('.git/config', names)
        self.assertFalse(any(name.startswith('node_modules/') for name in names))
        # Every entry is relative — the archive can never escape the
        # extraction directory.
        self.assertFalse(any(name.startswith('/') for name in names))
        self.assertFalse(any('..' in name.split('/') for name in names))

    def test_empty_repository_is_rejected(self):
        archive_path = os.path.join(self.output_dir, 'empty.zip')
        with self.assertRaises(GitHubRepositoryError):
            build_source_archive(self.workdir, archive_path)


class GitHubUploadEndpointTests(APITestCase):
    """The endpoint turns a repository URL into a scannable project."""

    URL = '/api/projects/github/'

    def setUp(self):
        self.user = User.objects.create_user(
            username='owner@example.com',
            email='owner@example.com',
            password='StrongPass1!',
        )
        self.client.force_authenticate(self.user)

        # A small source tree that stands in for the cloned repository.
        self.source = tempfile.mkdtemp(prefix='codeguard_github_src_')
        self.addCleanup(shutil.rmtree, self.source, ignore_errors=True)
        os.makedirs(os.path.join(self.source, 'src'))
        with open(os.path.join(self.source, 'src', 'app.js'), 'w', encoding='utf-8') as handle:
            handle.write('console.log(1);')
        with open(os.path.join(self.source, 'package.json'), 'w', encoding='utf-8') as handle:
            handle.write('{"name": "demo"}')

    def tearDown(self):
        # The uploaded archives live in MEDIA_ROOT — remove them again so a
        # test run never leaves files behind.
        for project in Project.objects.all():
            try:
                if project.zip_file.name:
                    project.zip_file.delete(save=False)
            except Exception:
                pass

    def _fake_fetch(self, owner, repo, destination, ref=None, token=None, timeout=None):
        shutil.copytree(self.source, destination, dirs_exist_ok=True)
        return destination

    def test_imports_a_repository_and_returns_a_validated_project(self):
        with mock.patch('projects.views.fetch_repository', side_effect=self._fake_fetch):
            response = self.client.post(
                self.URL,
                {'url': 'https://github.com/owner/repo'},
                format='json',
            )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED, response.content)
        self.assertTrue(response.data['isValid'])
        self.assertEqual(response.data['name'], 'repo')
        self.assertEqual(response.data['source'], 'github')
        self.assertEqual(response.data['repository']['owner'], 'owner')
        self.assertEqual(response.data['repository']['name'], 'repo')
        self.assertGreaterEqual(response.data['fileCount'], 1)
        self.assertIn('JavaScript', response.data['languages'])

        project = Project.objects.get(pk=response.data['id'])
        self.assertEqual(project.owner, self.user)
        self.assertTrue(project.zip_file.name.endswith('.zip'))
        with project.zip_file.open('rb') as handle:
            self.assertTrue(zipfile.is_zipfile(handle))

    def test_the_branch_is_forwarded_to_the_fetcher(self):
        with mock.patch('projects.views.fetch_repository', side_effect=self._fake_fetch) as fetch:
            response = self.client.post(
                self.URL,
                {'url': 'https://github.com/owner/repo', 'branch': 'develop'},
                format='json',
            )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED, response.content)
        self.assertEqual(fetch.call_args.kwargs['ref'], 'develop')
        self.assertEqual(response.data['repository']['ref'], 'develop')

    def test_the_access_token_is_used_but_never_stored_or_returned(self):
        with mock.patch('projects.views.fetch_repository', side_effect=self._fake_fetch) as fetch:
            response = self.client.post(
                self.URL,
                {'url': 'https://github.com/owner/repo', 'token': SECRET_TOKEN},
                format='json',
            )

        self.assertEqual(response.status_code, http_status.HTTP_201_CREATED, response.content)
        # The token is handed to the fetcher...
        self.assertEqual(fetch.call_args.kwargs['token'], SECRET_TOKEN)
        # ...but it never comes back to the client...
        self.assertNotIn(SECRET_TOKEN, json.dumps(response.data, default=str))
        # ...and it never ends up in the stored archive.
        project = Project.objects.get(pk=response.data['id'])
        with project.zip_file.open('rb') as handle:
            self.assertNotIn(SECRET_TOKEN.encode('utf-8'), handle.read())

    def test_a_url_that_is_not_a_github_repository_is_rejected(self):
        response = self.client.post(
            self.URL,
            {'url': 'https://gitlab.com/owner/repo'},
            format='json',
        )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertFalse(Project.objects.exists())

    def test_a_repository_error_is_reported_to_the_user(self):
        def explode(*args, **kwargs):
            raise GitHubRepositoryError('The repository owner/repo does not exist.')

        with mock.patch('projects.views.fetch_repository', side_effect=explode):
            response = self.client.post(
                self.URL,
                {'url': 'https://github.com/owner/repo'},
                format='json',
            )

        self.assertEqual(response.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertIn('does not exist', response.data['error'])
        self.assertFalse(Project.objects.exists())

    def test_the_endpoint_requires_authentication(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            self.URL,
            {'url': 'https://github.com/owner/repo'},
            format='json',
        )
        self.assertIn(
            response.status_code,
            (http_status.HTTP_401_UNAUTHORIZED, http_status.HTTP_403_FORBIDDEN),
        )

    def test_the_project_belongs_to_the_requesting_user(self):
        other = User.objects.create_user(
            username='other@example.com',
            email='other@example.com',
            password='StrongPass1!',
        )

        with mock.patch('projects.views.fetch_repository', side_effect=self._fake_fetch):
            response = self.client.post(
                self.URL,
                {'url': 'https://github.com/owner/repo'},
                format='json',
            )

        project = Project.objects.get(pk=response.data['id'])
        self.assertEqual(project.owner, self.user)
        self.assertNotEqual(project.owner, other)
