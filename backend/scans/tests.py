"""
Tests for the asynchronous scan lifecycle.

Covered:
  * fast scan creation (``POST /api/scans/start/`` queues work instead of
    running scanners inside the HTTP request),
  * owner isolation on every endpoint,
  * ZIP validation safety (traversal, drive letters, garbage input),
  * the DB-backed queue: atomic claims, no double execution,
  * terminal-state guarantees: completed / completed_with_warnings / failed
    on every execution path,
  * worker restart recovery and stale-job sweeping,
  * the lightweight status endpoint used by the frontend poller.
"""
import glob
import io
import json
import os
import shutil
import tempfile
import time
import uuid as uuid_mod
import zipfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from datetime import timedelta

from rest_framework import status as http_status
from rest_framework.test import APITestCase

from projects.models import Project
from projects.utils.zip_validator import (
    InvalidZipArchive,
    inspect_zip,
    safe_extract_zip,
    validate_zip,
)
from .models import Scan, WorkerHeartbeat
from .services.scan_worker import (
    claim_next_scan,
    make_worker_id,
    process_scan,
    public_error,
    recover_interrupted_scans,
    run_single_scan,
    scan_worker_snapshot,
    sweep_stale_scans,
)
from .services.scanner_runner import ScannerRunner, classify_scan_result
from .services.findings import summarize_scan
from .services import dependency as dependency_module
from .services.dependency import DependencyScanner
from .services import worker_launcher
from .services.worker_launcher import ensure_worker_running
from .services.worker_slot import WorkerSlot, probe_slot

User = get_user_model()

VALID_FILES = {
    'src/app.js': 'console.log("hello");\n',
    'package.json': '{"name": "demo", "version": "1.0.0"}',
    'README.md': '# demo project\n',
}


def make_zip_bytes(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buffer.getvalue()


VALID_ZIP_BYTES = make_zip_bytes(VALID_FILES)


# Tests do not need real password hashing (1.4s per hash on this machine
# would dominate the suite) — Django's documented test-only hasher instead.
FAST_PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']


class ScanTestEnvironment:
    """Per-test-class environment:
      * its own MEDIA_ROOT so no test file lands in the real media dir,
      * a fast password hasher so auth setup doesn't dominate run time.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._test_media_root = tempfile.mkdtemp(prefix='codeguard_test_media_')
        cls._media_override = override_settings(
            MEDIA_ROOT=cls._test_media_root,
            PASSWORD_HASHERS=FAST_PASSWORD_HASHERS,
        )
        cls._media_override.enable()
        cls.addClassCleanup(cls._media_override.disable)
        cls.addClassCleanup(shutil.rmtree, cls._test_media_root, ignore_errors=True)

    def make_project(self, owner, zip_bytes=VALID_ZIP_BYTES, name=None):
        """Create a project whose archive really exists on disk."""
        project = Project.objects.create(
            owner=owner,
            name=name or f'proj-{uuid_mod.uuid4().hex[:8]}',
            zip_file=f'uploads/{uuid_mod.uuid4().hex}.zip',
        )
        path = project.zip_file.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as handle:
            handle.write(zip_bytes)
        return project


class AuthMixin:
    PASSWORD = 'StrongPass1!'

    def make_user(self, email=None):
        email = email or f'{uuid_mod.uuid4().hex[:10]}@example.com'
        return User.objects.create_user(
            username=email, email=email, password=self.PASSWORD,
        )

    def login(self, user):
        res = self.client.post(
            '/api/auth/login/',
            {'email': user.email, 'password': self.PASSWORD},
            format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return res.data['access']


# ─────────────────────────────────────────────────────────────────────────────
# Scan creation endpoint
# ─────────────────────────────────────────────────────────────────────────────

class ScanCreationTests(ScanTestEnvironment, AuthMixin, APITestCase):
    START_URL = '/api/scans/start/'

    def start(self, project, scanners=None):
        return self.client.post(
            self.START_URL,
            {
                'project_id': str(project.id),
                'selected_scanners': (
                    ['semgrep', 'gitleaks', 'dependency']
                    if scanners is None else scanners
                ),
            },
            format='json',
        )

    def test_create_scan_is_fast_and_queues_instead_of_running(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)

        started = time.monotonic()
        res = self.start(project)
        elapsed = time.monotonic() - started

        self.assertEqual(res.status_code, http_status.HTTP_201_CREATED, res.data)
        # The whole point of the fix: creation must not wait for scanners.
        self.assertLess(
            elapsed, 1.0,
            f'scan creation took {elapsed:.3f}s — scanners appear to run in-request',
        )
        self.assertEqual(res.data['status'], 'queued')
        self.assertEqual(res.data['stage'], 'queued')
        self.assertEqual(res.data['progress'], 0)
        self.assertFalse(res.data['is_terminal'])
        self.assertIsNone(res.data['completed_at'])

        scan = Scan.objects.get(pk=res.data['id'])
        self.assertEqual(scan.status, 'queued')
        self.assertEqual(scan.scanners, ['semgrep', 'gitleaks', 'dependency'])
        self.assertTrue(scan.result['validation']['isValid'])
        self.assertEqual(scan.result['scans'], {})

    def test_create_scan_never_invokes_scanner_runner(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)

        with mock.patch('scans.services.scan_worker.ScannerRunner') as runner_cls:
            res = self.start(project)
            runner_cls.assert_not_called()

        self.assertEqual(res.status_code, http_status.HTTP_201_CREATED)
        scan = Scan.objects.get(pk=res.data['id'])
        self.assertEqual(scan.status, 'queued')  # nothing executed synchronously

    def test_missing_project_id_rejected(self):
        user = self.make_user()
        self.login(user)
        res = self.client.post(
            self.START_URL, {'selected_scanners': ['semgrep']}, format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_400_BAD_REQUEST)

    def test_malformed_project_id_rejected_not_500(self):
        user = self.make_user()
        self.login(user)
        res = self.client.post(
            self.START_URL,
            {'project_id': 'not-a-uuid', 'selected_scanners': ['semgrep']},
            format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Scan.objects.count(), 0)

    def test_empty_or_malformed_scanner_list_rejected(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)

        for bad in ([], 'semgrep', [1, 2], None):
            res = self.client.post(
                self.START_URL,
                {'project_id': str(project.id), 'selected_scanners': bad},
                format='json',
            )
            self.assertEqual(
                res.status_code, http_status.HTTP_400_BAD_REQUEST,
                f'scanners={bad!r} should be rejected',
            )
        self.assertEqual(Scan.objects.count(), 0)

    def test_unsupported_scanner_name_rejected(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)

        # 'config' was a UI-only option with no backend implementation; it
        # (and any other unknown name) must be rejected up front rather than
        # queued as a scan guaranteed to end in completed_with_warnings/failed.
        for name in ('config', 'definitely_not_a_scanner'):
            res = self.client.post(
                self.START_URL,
                {'project_id': str(project.id), 'selected_scanners': [name]},
                format='json',
            )
            self.assertEqual(
                res.status_code, http_status.HTTP_400_BAD_REQUEST,
                f'{name!r} should be rejected',
            )
            self.assertIn('error', res.data)
            self.assertIn(name, res.data['error'])
            self.assertEqual(
                sorted(res.data['supported_scanners']),
                ['dependency', 'gitleaks', 'semgrep'],
            )
        self.assertEqual(Scan.objects.count(), 0)

    def test_mixed_valid_and_invalid_scanners_rejected(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)

        res = self.client.post(
            self.START_URL,
            {'project_id': str(project.id), 'selected_scanners': ['semgrep', 'config']},
            format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertIn('config', res.data['error'])
        self.assertEqual(Scan.objects.count(), 0)

    def test_duplicate_scanner_names_are_deduplicated(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)

        res = self.client.post(
            self.START_URL,
            {'project_id': str(project.id), 'selected_scanners': ['semgrep', 'semgrep']},
            format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_201_CREATED, res.data)
        scan = Scan.objects.get(pk=res.data['id'])
        self.assertEqual(scan.scanners, ['semgrep'])

    def test_foreign_project_returns_404_and_creates_no_scan(self):
        owner = self.make_user()
        intruder = self.make_user()
        self.login(intruder)
        project = self.make_project(owner)

        res = self.start(project)
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(Scan.objects.count(), 0)

    def test_unknown_project_returns_404(self):
        user = self.make_user()
        self.login(user)
        res = self.client.post(
            self.START_URL,
            {'project_id': str(uuid_mod.uuid4()), 'selected_scanners': ['semgrep']},
            format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_unauthenticated_rejected(self):
        project = Project.objects.create(
            owner=self.make_user(), name='p',
            zip_file=f'uploads/{uuid_mod.uuid4().hex}.zip',
        )
        res = self.client.post(
            self.START_URL,
            {'project_id': str(project.id), 'selected_scanners': ['semgrep']},
            format='json',
        )
        self.assertEqual(res.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_invalid_zip_rejected_before_scan_is_created(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user, zip_bytes=b'this is definitely not a zip')

        res = self.start(project)
        self.assertEqual(res.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', res.data)
        self.assertEqual(Scan.objects.count(), 0)

    def test_zip_slip_archive_rejected_before_scan_is_created(self):
        user = self.make_user()
        self.login(user)
        evil = make_zip_bytes({'../evil.js': 'pwned', 'ok.js': 'fine'})
        project = self.make_project(user, zip_bytes=evil)

        res = self.start(project)
        self.assertEqual(res.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Scan.objects.count(), 0)

    def test_missing_archive_on_disk_returns_400(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)
        os.remove(project.zip_file.path)

        res = self.start(project)
        self.assertEqual(res.status_code, http_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Scan.objects.count(), 0)


# ─────────────────────────────────────────────────────────────────────────────
# Scan detail deletion
# ─────────────────────────────────────────────────────────────────────────────

class ScanDetailDeleteTests(ScanTestEnvironment, AuthMixin, APITestCase):
    def test_owner_can_delete_scan(self):
        owner = self.make_user()
        self.login(owner)
        project = self.make_project(owner)
        scan = Scan.objects.create(project=project, status='completed')

        response = self.client.delete(f'/api/scans/{scan.pk}/')

        self.assertEqual(response.status_code, http_status.HTTP_204_NO_CONTENT)
        self.assertFalse(Scan.objects.filter(pk=scan.pk).exists())
        self.assertTrue(Project.objects.filter(pk=project.pk).exists())

    def test_foreign_scan_cannot_be_deleted(self):
        owner = self.make_user()
        intruder = self.make_user()
        project = self.make_project(owner)
        scan = Scan.objects.create(project=project, status='completed')
        self.login(intruder)

        response = self.client.delete(f'/api/scans/{scan.pk}/')

        self.assertEqual(response.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertTrue(Scan.objects.filter(pk=scan.pk).exists())

    def test_active_scan_cannot_be_deleted(self):
        owner = self.make_user()
        self.login(owner)
        project = self.make_project(owner)
        scan = Scan.objects.create(project=project, status='running')

        response = self.client.delete(f'/api/scans/{scan.pk}/')

        self.assertEqual(response.status_code, http_status.HTTP_409_CONFLICT)
        self.assertTrue(Scan.objects.filter(pk=scan.pk).exists())

    def test_unauthenticated_delete_is_rejected(self):
        owner = self.make_user()
        project = self.make_project(owner)
        scan = Scan.objects.create(project=project, status='completed')

        response = self.client.delete(f'/api/scans/{scan.pk}/')

        self.assertEqual(response.status_code, http_status.HTTP_401_UNAUTHORIZED)
        self.assertTrue(Scan.objects.filter(pk=scan.pk).exists())


# ─────────────────────────────────────────────────────────────────────────────
# Status endpoint (frontend polling target)
# ─────────────────────────────────────────────────────────────────────────────

class ScanStatusEndpointTests(ScanTestEnvironment, AuthMixin, APITestCase):
    def url(self, scan):
        return f'/api/scans/{scan.pk}/status/'

    def queued_scan(self, project, **kwargs):
        fields = dict(
            project=project, scanners=['semgrep', 'gitleaks'],
            status='queued', stage='queued', progress=0,
            started_at=timezone.now(), completed_at=None,
            result={'validation': {'isValid': True}, 'scans': {}},
        )
        fields.update(kwargs)
        return Scan.objects.create(**fields)

    def test_unauthenticated_rejected(self):
        user = self.make_user()
        project = self.make_project(user)
        scan = self.queued_scan(project)
        res = self.client.get(self.url(scan))
        self.assertEqual(res.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_foreign_scan_returns_404(self):
        owner = self.make_user()
        intruder = self.make_user()
        self.login(intruder)
        project = self.make_project(owner)
        scan = self.queued_scan(project)
        res = self.client.get(self.url(scan))
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_owner_receives_full_snapshot(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)
        scan = self.queued_scan(project)

        res = self.client.get(self.url(scan))
        self.assertEqual(res.status_code, http_status.HTTP_200_OK)
        data = res.data
        self.assertEqual(data['status'], 'queued')
        self.assertEqual(data['stage'], 'queued')
        self.assertEqual(data['progress'], 0)
        self.assertFalse(data['is_terminal'])
        self.assertFalse(data['worker_online'])  # no heartbeat in tests
        self.assertFalse(data['has_results'])
        self.assertEqual(data['error'], '')
        self.assertEqual(data['scanner_status'], {'semgrep': 'pending', 'gitleaks': 'pending'})

    def test_polling_never_creates_or_duplicates_scans(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)
        scan = self.queued_scan(project)

        for _ in range(3):
            res = self.client.get(self.url(scan))
            self.assertEqual(res.status_code, http_status.HTTP_200_OK)

        self.assertEqual(Scan.objects.count(), 1)
        scan.refresh_from_db()
        self.assertEqual(scan.status, 'queued')  # GET must not mutate state

    def test_terminal_snapshot(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)
        scan = self.queued_scan(
            project,
            status='completed',
            stage='done',
            progress=100,
            completed_at=timezone.now(),
            result={
                'validation': {'isValid': True},
                'scans': {'semgrep': {'findings': []}},
            },
        )

        data = self.client.get(self.url(scan)).data
        self.assertTrue(data['is_terminal'])
        self.assertTrue(data['has_results'])
        self.assertEqual(data['scanner_status'], {'semgrep': 'completed', 'gitleaks': 'completed'})
        self.assertEqual(data['progress'], 100)

    def test_error_detail_is_path_scrubbed(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)
        leak = os.path.join(tempfile.gettempdir(), 'codeguard_scan_abc')
        scan = self.queued_scan(
            project, status='failed', stage='failed',
            error=f'crashed while reading {leak}/file.py',
        )

        data = self.client.get(self.url(scan)).data
        self.assertNotIn(tempfile.gettempdir(), data['error'])
        self.assertIn('[path]', data['error'])

    def test_scanner_availability_endpoint(self):
        user = self.make_user()
        self.login(user)
        res = self.client.get('/api/scans/scanners/')
        self.assertEqual(res.status_code, http_status.HTTP_200_OK)
        for name in ('semgrep', 'gitleaks', 'dependency'):
            self.assertIn(name, res.data)
            self.assertIn('available', res.data[name])
            self.assertIsInstance(res.data[name]['available'], bool)
            self.assertIn('hint', res.data[name])

    def test_scan_list_exposes_lifecycle_fields(self):
        user = self.make_user()
        self.login(user)
        project = self.make_project(user)
        self.queued_scan(project)
        res = self.client.get('/api/scans/')
        self.assertEqual(res.status_code, http_status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        row = res.data[0]
        for field in ('status', 'stage', 'progress', 'error', 'is_terminal'):
            self.assertIn(field, row)


# ─────────────────────────────────────────────────────────────────────────────
# Queue: atomic claims, no double execution
# ─────────────────────────────────────────────────────────────────────────────

class QueueClaimTests(ScanTestEnvironment, TestCase):
    def setUp(self):
        self.user = self.make_user()
        self.project = self.make_project(self.user)

    def make_user(self):
        return User.objects.create_user(
            username=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            email=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            password='StrongPass1!',
        )

    def queued(self, scanners=None):
        return Scan.objects.create(
            project=self.project,
            scanners=scanners or ['semgrep'],
            status='queued', stage='queued',
            started_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )

    def test_claim_moves_oldest_queued_scan_to_preparing(self):
        scan = self.queued()
        claimed = claim_next_scan('worker-1')
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed.pk, scan.pk)
        scan.refresh_from_db()
        self.assertEqual(scan.status, 'preparing')
        self.assertEqual(scan.stage, 'validating_archive')
        self.assertEqual(scan.worker_id, 'worker-1')

    def test_claims_are_handed_out_one_at_a_time(self):
        first = self.queued()
        second = self.queued()

        claim_a = claim_next_scan('w-a')
        claim_b = claim_next_scan('w-b')
        claim_c = claim_next_scan('w-c')

        self.assertEqual(claim_a.pk, first.pk)
        self.assertEqual(claim_b.pk, second.pk)
        self.assertIsNone(claim_c)

    def test_already_claimed_scan_cannot_be_claimed_again(self):
        scan = self.queued()
        first = claim_next_scan('w-a')
        self.assertEqual(first.pk, scan.pk)

        # Second worker's claim pass skips it (status no longer queued).
        second = claim_next_scan('w-b')
        self.assertIsNone(second)

        # Direct conditional update (what claim does internally) is atomic.
        stolen = Scan.objects.filter(pk=scan.pk, status__in=('queued', 'pending')).update(
            status='preparing', worker_id='w-b',
        )
        self.assertEqual(stolen, 0)
        scan.refresh_from_db()
        self.assertEqual(scan.worker_id, 'w-a')

    def test_legacy_pending_rows_are_claimed(self):
        scan = self.queued()
        Scan.objects.filter(pk=scan.pk).update(status='pending')
        claimed = claim_next_scan('w-legacy')
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed.pk, scan.pk)

    def test_process_scan_ignores_jobs_owned_by_another_worker(self):
        self.queued()
        claimed = claim_next_scan('owner-worker')

        with mock.patch('scans.services.scan_worker.ScannerRunner') as runner_cls:
            process_scan(claimed.pk, 'intruder-worker')
            runner_cls.assert_not_called()

        claimed.refresh_from_db()
        self.assertEqual(claimed.status, 'preparing')
        self.assertEqual(claimed.worker_id, 'owner-worker')

    def test_run_single_scan_claims_the_requested_job(self):
        scan = self.queued()
        result = run_single_scan(scan.pk, worker_id='solo-worker')
        self.assertEqual(result.pk, scan.pk)
        scan.refresh_from_db()
        self.assertEqual(scan.worker_id, 'solo-worker')


# ─────────────────────────────────────────────────────────────────────────────
# Processing: every path reaches a terminal state
# ─────────────────────────────────────────────────────────────────────────────

class ProcessScanTests(ScanTestEnvironment, TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            email=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            password='StrongPass1!',
        )
        self.project = self.make_project(self.user)

    def queued(self, scanners=None):
        return Scan.objects.create(
            project=self.project,
            scanners=['semgrep', 'gitleaks'] if scanners is None else scanners,
            status='queued', stage='queued',
            started_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )

    def run_with_results(self, scan, results):
        """Run the worker with ``ScannerRunner.run_all`` mocked to `results`."""
        with mock.patch('scans.services.scan_worker.ScannerRunner') as runner_cls:
            runner_cls.return_value.run_all.side_effect = (
                lambda on_progress=None: results
            )
            run_single_scan(scan.pk, worker_id='test-worker')
        scan.refresh_from_db()
        return scan

    def test_all_scanners_ok_completes(self):
        scan = self.queued()
        results = {
            'semgrep': {'findings': [], 'summary': 'clean'},
            'gitleaks': {'findings': []},
        }
        scan = self.run_with_results(scan, results)

        self.assertEqual(scan.status, 'completed')
        self.assertEqual(scan.stage, 'done')
        self.assertEqual(scan.progress, 100)
        self.assertEqual(scan.error, '')
        self.assertIsNotNone(scan.completed_at)
        self.assertEqual(scan.result['scans'], results)
        self.assertTrue(scan.is_terminal)

    def test_partial_scanner_failure_completes_with_warnings(self):
        scan = self.queued()
        scan = self.run_with_results(scan, {
            'semgrep': {'findings': []},
            'gitleaks': {'error': 'gitleaks executable disappeared'},
        })

        self.assertEqual(scan.status, 'completed_with_warnings')
        self.assertIn('gitleaks', scan.error)
        self.assertEqual(scan.result['scans']['semgrep'], {'findings': []})
        self.assertIsNotNone(scan.completed_at)
        self.assertTrue(scan.is_terminal)

    def test_skipped_scanner_counts_as_success_not_failure(self):
        scan = self.queued(scanners=['dependency', 'semgrep'])
        scan = self.run_with_results(scan, {
            'dependency': {'skipped': True, 'reason': 'No package.json found.'},
            'semgrep': {'error': 'timed out'},
        })
        self.assertEqual(scan.status, 'completed_with_warnings')

        scan2 = self.queued(scanners=['dependency'])
        scan2 = self.run_with_results(scan2, {
            'dependency': {'skipped': True, 'reason': 'No package.json found.'},
        })
        self.assertEqual(scan2.status, 'completed')

    def test_every_scanner_failing_fails_the_scan(self):
        scan = self.queued()
        scan = self.run_with_results(scan, {
            'semgrep': {'error': 'boom'},
            'gitleaks': {'error': 'bang'},
        })

        self.assertEqual(scan.status, 'failed')
        self.assertEqual(scan.stage, 'failed')
        self.assertIn('semgrep', scan.error)
        self.assertIn('gitleaks', scan.error)
        self.assertIsNotNone(scan.completed_at)
        self.assertTrue(scan.is_terminal)

    def test_unexpected_runner_exception_still_terminates(self):
        scan = self.queued()
        with mock.patch('scans.services.scan_worker.ScannerRunner') as runner_cls:
            runner_cls.return_value.run_all.side_effect = RuntimeError('kaboom')
            run_single_scan(scan.pk, worker_id='test-worker')
        scan.refresh_from_db()

        self.assertEqual(scan.status, 'failed')
        self.assertIn('kaboom', scan.error)
        self.assertIsNotNone(scan.completed_at)

    def test_no_scanners_selected_fails_with_clear_error(self):
        scan = self.queued(scanners=[])
        with mock.patch('scans.services.scan_worker.ScannerRunner') as runner_cls:
            run_single_scan(scan.pk, worker_id='test-worker')
            runner_cls.assert_not_called()
        scan.refresh_from_db()

        self.assertEqual(scan.status, 'failed')
        self.assertIn('No scanners', scan.error)

    def test_corrupt_archive_fails_validation_stage(self):
        # Overwrite the archive with garbage after the scan was queued.
        with open(self.project.zip_file.path, 'wb') as handle:
            handle.write(b'corrupted bytes, not a zip')
        scan = self.queued()

        run_single_scan(scan.pk, worker_id='test-worker')
        scan.refresh_from_db()

        self.assertEqual(scan.status, 'failed')
        self.assertIn('Invalid ZIP archive', scan.error)
        self.assertIsNotNone(scan.completed_at)

    def test_partial_results_are_persisted_while_scanners_run(self):
        scan = self.queued()
        observed = {}

        def fake_run_all(on_progress=None):
            on_progress('started', 'semgrep', None, 0, 2)
            on_progress('finished', 'semgrep', {'findings': []}, 1, 2)
            mid = Scan.objects.get(pk=scan.pk)
            observed['status'] = mid.status
            observed['progress'] = mid.progress
            observed['stage'] = mid.stage
            observed['scans'] = dict((mid.result or {}).get('scans') or {})
            on_progress('finished', 'gitleaks', {'findings': [1]}, 2, 2)
            return {'semgrep': {'findings': []}, 'gitleaks': {'findings': [1]}}

        with mock.patch('scans.services.scan_worker.ScannerRunner') as runner_cls:
            runner_cls.return_value.run_all.side_effect = fake_run_all
            run_single_scan(scan.pk, worker_id='test-worker')

        self.assertEqual(observed['status'], 'running')
        self.assertEqual(observed['progress'], 50)
        self.assertEqual(observed['scans'], {'semgrep': {'findings': []}})

        scan.refresh_from_db()
        self.assertEqual(scan.status, 'completed')
        self.assertEqual(scan.progress, 100)
        self.assertEqual(len(scan.result['scans']), 2)

    def test_extraction_directory_is_cleaned_up(self):
        pattern = os.path.join(tempfile.gettempdir(), 'codeguard_scan_*')
        before = set(glob.glob(pattern))

        scan = self.queued()
        self.run_with_results(scan, {'semgrep': {'findings': []}, 'gitleaks': {'findings': []}})

        leaked = set(glob.glob(pattern)) - before
        self.assertEqual(leaked, set(), f'temp dirs leaked: {leaked}')


# ─────────────────────────────────────────────────────────────────────────────
# Recovery: worker restarts, interrupted jobs, stale sweeps
# ─────────────────────────────────────────────────────────────────────────────

class RecoveryTests(ScanTestEnvironment, TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            email=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            password='StrongPass1!',
        )
        self.project = self.make_project(self.user)
        WorkerHeartbeat.clear()

    def tearDown(self):
        WorkerHeartbeat.clear()

    def stuck_scan(self, status_value='running', updated_at=None):
        scan = Scan.objects.create(
            project=self.project, scanners=['semgrep'],
            status=status_value, stage='running',
            started_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )
        if updated_at is not None:
            # Bypass auto_now to backdate the heartbeat.
            Scan.objects.filter(pk=scan.pk).update(updated_at=updated_at)
            scan.refresh_from_db()
        return scan

    def test_interrupted_scan_is_requeued_when_no_worker_is_alive(self):
        scan = self.stuck_scan()
        requeued = recover_interrupted_scans()

        self.assertEqual(requeued, 1)
        scan.refresh_from_db()
        self.assertEqual(scan.status, 'queued')
        self.assertEqual(scan.stage, 'queued')
        self.assertEqual(scan.worker_id, '')
        self.assertIn('worker restart', scan.error.lower())

    def test_startup_recovery_does_not_strand_jobs_on_a_fresh_heartbeat(self):
        """
        Regression: after a crash/SIGKILL the dead worker's heartbeat row can
        still be inside its freshness window.  Startup recovery must requeue
        its jobs anyway, otherwise the scan stays 'running' forever.
        """
        WorkerHeartbeat.beat('killed-worker')  # fresh, but the worker is dead
        scan = self.stuck_scan(updated_at=timezone.now())

        requeued = recover_interrupted_scans(requeue_all=True)

        self.assertEqual(requeued, 1)
        scan.refresh_from_db()
        self.assertEqual(scan.status, 'queued')
        self.assertEqual(scan.worker_id, '')

    def test_live_worker_keeps_its_fresh_jobs(self):
        WorkerHeartbeat.beat('other-live-worker')
        scan = self.stuck_scan(updated_at=timezone.now())
        requeued = recover_interrupted_scans()

        self.assertEqual(requeued, 0)
        scan.refresh_from_db()
        self.assertEqual(scan.status, 'running')

    def test_live_worker_stale_jobs_are_requeued(self):
        WorkerHeartbeat.beat('other-live-worker')
        stale_time = timezone.now() - timedelta(
            seconds=scan_worker_stale_timeout() + 60,
        )
        scan = self.stuck_scan(updated_at=stale_time)
        requeued = recover_interrupted_scans()

        self.assertEqual(requeued, 1)
        scan.refresh_from_db()
        self.assertEqual(scan.status, 'queued')

    def test_recover_leaves_terminal_and_queued_scans_untouched(self):
        completed = self.stuck_scan(status_value='completed')
        queued = self.stuck_scan(status_value='queued')
        requeued = recover_interrupted_scans()
        self.assertEqual(requeued, 0)
        completed.refresh_from_db()
        queued.refresh_from_db()
        self.assertEqual(completed.status, 'completed')
        self.assertEqual(queued.status, 'queued')

    def test_sweep_fails_stale_active_scans(self):
        stale_time = timezone.now() - timedelta(
            seconds=scan_worker_stale_timeout() + 60,
        )
        stale = self.stuck_scan(status_value='preparing', updated_at=stale_time)
        fresh = self.stuck_scan(status_value='queued', updated_at=timezone.now())
        done = self.stuck_scan(status_value='completed', updated_at=stale_time)

        sweep_stale_scans()

        stale.refresh_from_db()
        fresh.refresh_from_db()
        done.refresh_from_db()

        self.assertEqual(stale.status, 'failed')
        self.assertIn('interrupted', stale.error.lower())
        self.assertIsNotNone(stale.completed_at)
        self.assertEqual(fresh.status, 'queued')
        self.assertEqual(done.status, 'completed')

    def test_snapshot_reports_worker_offline(self):
        scan = self.stuck_scan(status_value='queued')
        snap = scan_worker_snapshot(scan)
        self.assertFalse(snap['worker_online'])
        WorkerHeartbeat.beat('worker-x')
        snap = scan_worker_snapshot(scan)
        self.assertTrue(snap['worker_online'])

    def test_snapshot_marks_currently_running_scanner(self):
        scan = Scan.objects.create(
            project=self.project, scanners=['semgrep', 'gitleaks'],
            status='running', stage='running:semgrep', progress=25,
            started_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )
        snap = scan_worker_snapshot(scan)
        self.assertEqual(snap['scanner_status'], {'semgrep': 'running', 'gitleaks': 'pending'})


def scan_worker_stale_timeout():
    from .services.scan_worker import STALE_SCAN_TIMEOUT_SECONDS
    return STALE_SCAN_TIMEOUT_SECONDS


# ─────────────────────────────────────────────────────────────────────────────
# Pure-function units
# ─────────────────────────────────────────────────────────────────────────────

class ClassifyScanResultTests(SimpleTestCase):
    def test_outcomes(self):
        self.assertEqual(classify_scan_result({'findings': []}), 'ok')
        self.assertEqual(classify_scan_result({'skipped': True, 'reason': 'n/a'}), 'skipped')
        self.assertEqual(classify_scan_result({'error': 'boom'}), 'error')
        self.assertEqual(classify_scan_result('garbage'), 'error')
        self.assertEqual(classify_scan_result(None), 'error')
        # skipped + error → execution was skipped, not a failure of the tool
        self.assertEqual(classify_scan_result({'skipped': True, 'error': ''}), 'skipped')


class ScannerUnavailableTests(SimpleTestCase):
    """
    A scanner whose executable is not installed on the host reports
    ``unavailable: True``.  That is a deployment choice (semgrep is
    intentionally absent on small free hosts), not an execution failure —
    ``run_all`` must translate it to a *skipped* result so one missing tool
    can neither fail nor downgrade the whole scan.
    """

    def test_unavailable_scanner_is_reported_as_skipped(self):
        temp_dir = tempfile.mkdtemp(prefix='codeguard_avail_test_')
        self.addCleanup(shutil.rmtree, temp_dir, ignore_errors=True)

        class OkScanner:
            def __init__(self, project_path):
                pass

            def scan(self):
                return {'findings': []}

        class MissingScanner:
            def __init__(self, project_path):
                pass

            def scan(self):
                return {
                    'error': 'semgrep executable not found. Install it.',
                    'unavailable': True,
                }

        original_map = ScannerRunner.SCANNER_MAP
        ScannerRunner.SCANNER_MAP = {'gitleaks': OkScanner, 'semgrep': MissingScanner}
        try:
            results = ScannerRunner(temp_dir, ['gitleaks', 'semgrep']).run_all()
        finally:
            ScannerRunner.SCANNER_MAP = original_map

        self.assertEqual(classify_scan_result(results['gitleaks']), 'ok')
        self.assertEqual(classify_scan_result(results['semgrep']), 'skipped')
        self.assertTrue(results['semgrep'].get('unavailable'))
        self.assertIn('semgrep executable not found', results['semgrep']['reason'])


class GitleaksResultPathTests(TestCase):
    """
    gitleaks reports absolute paths in its own convention; stored findings
    must expose a project-relative, forward-slash path (regression guard —
    this previously leaked the server temp directory into the UI).
    """

    def make_scanner(self, project_path):
        from .services.gitleaks import GitleaksScanner
        return GitleaksScanner(project_path)

    def run_with_report(self, project_path, report, returncode=1):
        from unittest import mock
        import tempfile as _tempfile

        scanner = self.make_scanner(project_path)

        class FakeCompleted:
            def __init__(self):
                self.returncode = returncode
                self.stdout = ''
                self.stderr = ''

        real_named_temporary_file = _tempfile.NamedTemporaryFile

        def fake_run(cmd, capture=True, text=True, encoding=None, timeout=None, **kwargs):
            # The report path is the last argument of --report-path.
            report_path = cmd[cmd.index('--report-path') + 1]
            with open(report_path, 'w', encoding='utf-8') as handle:
                json.dump(report, handle)
            return FakeCompleted()

        with mock.patch('scans.services.gitleaks._find_gitleaks', return_value='gitleaks'), \
             mock.patch('scans.services.gitleaks.subprocess.run', side_effect=fake_run):
            return scanner.scan()

    def test_absolute_temp_paths_become_relative(self):
        workdir = tempfile.mkdtemp(prefix='codeguard_gitleaks_test_')
        self.addCleanup(shutil.rmtree, workdir, ignore_errors=True)
        os.makedirs(os.path.join(workdir, 'config'), exist_ok=True)

        abs_file = os.path.join(workdir, 'config', 'creds.py')
        report = [{
            'RuleID': 'generic-api-key',
            'File': abs_file.replace('\\', '/'),
            'StartLine': 2,
            'Secret': 'redacted',
        }]

        result = self.run_with_report(workdir, report)

        self.assertNotIn('error', result)
        self.assertEqual(result['all_vulnerabilities'][0]['File'], 'config/creds.py')
        self.assertEqual(result['all_vulnerabilities'][0]['absolute_path'], abs_file.replace('\\', '/'))

    def test_relative_paths_are_left_intact(self):
        workdir = tempfile.mkdtemp(prefix='codeguard_gitleaks_test_')
        self.addCleanup(shutil.rmtree, workdir, ignore_errors=True)
        report = [{'RuleID': 'generic-api-key', 'File': 'config/creds.py', 'StartLine': 1}]

        result = self.run_with_report(workdir, report)

        self.assertEqual(result['all_vulnerabilities'][0]['File'], 'config/creds.py')
        self.assertNotIn('absolute_path', result['all_vulnerabilities'][0])

    def test_timeout_flag_is_passed_to_gitleaks(self):
        """gitleaks 8.x does not time out by default — we must bound it."""
        from unittest import mock
        from .services import gitleaks as gitleaks_module

        workdir = tempfile.mkdtemp(prefix='codeguard_gitleaks_test_')
        self.addCleanup(shutil.rmtree, workdir, ignore_errors=True)
        scanner = self.make_scanner(workdir)
        captured = {}

        class FakeCompleted:
            returncode = 0
            stdout = ''
            stderr = ''

        def fake_run(cmd, **kwargs):
            captured['cmd'] = cmd
            report_path = cmd[cmd.index('--report-path') + 1]
            with open(report_path, 'w', encoding='utf-8') as handle:
                handle.write('[]')
            return FakeCompleted()

        with mock.patch('scans.services.gitleaks._find_gitleaks', return_value='gitleaks'), \
             mock.patch('scans.services.gitleaks.subprocess.run', side_effect=fake_run):
            scanner.scan()

        self.assertIn('--timeout', captured['cmd'])
        timeout_value = int(captured['cmd'][captured['cmd'].index('--timeout') + 1])
        self.assertGreater(timeout_value, 0)
        self.assertLess(timeout_value, gitleaks_module.GITLEAKS_TIMEOUT)


class PublicErrorTests(SimpleTestCase):
    def test_scrubs_known_base_paths_and_truncates(self):
        raw = f'failure in {tempfile.gettempdir()}/codeguard_scan_123/index.js'
        cleaned = public_error(raw)
        self.assertNotIn(tempfile.gettempdir(), cleaned)
        self.assertIn('[path]', cleaned)

    def test_empty_and_long_messages(self):
        self.assertEqual(public_error(''), '')
        self.assertEqual(public_error(None), '')
        # Stored detail is capped at 4000 chars, exposure is capped at 500.
        self.assertEqual(len(public_error('x' * 10_000)), 500)


class ZipSafetyTests(SimpleTestCase):
    def setUp(self):
        self.workdir = tempfile.mkdtemp(prefix='codeguard_zip_test_')
        self.addCleanup(shutil.rmtree, self.workdir, ignore_errors=True)

    def write_zip(self, files, name='archive.zip'):
        path = os.path.join(self.workdir, name)
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for entry, content in files.items():
                zf.writestr(entry, content)
        return path

    def test_inspect_valid_archive(self):
        path = self.write_zip(VALID_FILES)
        payload = inspect_zip(path)
        self.assertTrue(payload['isValid'])
        self.assertEqual(payload['fileCount'], 3)
        self.assertIn('JavaScript', payload['languages'])
        self.assertEqual(payload['errors'], [])

    def test_inspect_rejects_garbage_and_missing_files(self):
        garbage = os.path.join(self.workdir, 'garbage.zip')
        with open(garbage, 'wb') as handle:
            handle.write(b'nope')
        with self.assertRaises(InvalidZipArchive):
            inspect_zip(garbage)
        with self.assertRaises(InvalidZipArchive):
            inspect_zip(os.path.join(self.workdir, 'missing.zip'))
        with self.assertRaises(InvalidZipArchive):
            inspect_zip('')

    def test_inspect_rejects_traversal_and_drive_paths(self):
        for entry in ('../evil.js', 'foo/../../evil.js', '/etc/passwd',
                      'C:/Windows/evil.dll', '..\\evil.js'):
            path = self.write_zip({entry: 'x', 'safe.txt': 'ok'},
                                  name=f'{abs(hash(entry))}.zip')
            with self.assertRaises(InvalidZipArchive, msg=entry):
                inspect_zip(path)

    def test_inspect_rejects_empty_archive(self):
        path = self.write_zip({'folder/': ''})
        with self.assertRaises(InvalidZipArchive):
            inspect_zip(path)

    def test_validate_zip_never_raises(self):
        garbage = os.path.join(self.workdir, 'garbage2.zip')
        with open(garbage, 'wb') as handle:
            handle.write(b'nope')
        payload = validate_zip(garbage)
        self.assertFalse(payload['isValid'])
        self.assertTrue(payload['errors'])

        good = self.write_zip(VALID_FILES, name='good.zip')
        self.assertTrue(validate_zip(good)['isValid'])

    def test_safe_extract_writes_files(self):
        src = self.write_zip(VALID_FILES)
        dest = os.path.join(self.workdir, 'out')
        os.makedirs(dest, exist_ok=True)
        written = safe_extract_zip(src, dest)
        self.assertEqual(written, 3)
        self.assertTrue(os.path.isfile(os.path.join(dest, 'src', 'app.js')))

    def test_safe_extract_blocks_zip_slip(self):
        src = self.write_zip({'../escaped.js': 'pwned'})
        dest = os.path.join(self.workdir, 'sandbox')
        os.makedirs(dest, exist_ok=True)
        with self.assertRaises(InvalidZipArchive):
            safe_extract_zip(src, dest)
        self.assertFalse(
            os.path.exists(os.path.join(self.workdir, 'escaped.js')),
            'zip-slip file escaped the extraction directory',
        )


# ─────────────────────────────────────────────────────────────────────────────
# Dependency scanner discovery (lockfile vs package.json-only)
# ─────────────────────────────────────────────────────────────────────────────

class DependencyScannerDiscoveryTests(TestCase):
    """
    ``npm audit`` requires a lockfile.  A project with only ``package.json``
    must be reported as *skipped*, not *error*, so a scan is not wrongly
    downgraded to completed_with_warnings.
    """

    def setUp(self):
        self.workdir = tempfile.mkdtemp(prefix='codeguard_dep_test_')
        self.addCleanup(shutil.rmtree, self.workdir, ignore_errors=True)

    def _write(self, name, content):
        path = os.path.join(self.workdir, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(content)

    def test_package_json_without_lockfile_is_skipped(self):
        self._write('package.json', '{"name": "demo"}')
        with mock.patch.object(dependency_module, '_find_npm', return_value='npm'):
            with mock.patch.object(dependency_module.subprocess, 'run') as run:
                result = DependencyScanner(self.workdir).scan()
        # npm must never be invoked — there is nothing to audit.
        run.assert_not_called()
        self.assertTrue(result.get('skipped'))
        self.assertIn('package-lock.json', result['reason'])
        self.assertEqual(classify_scan_result(result), 'skipped')

    def test_no_manifest_is_skipped(self):
        self._write('src/app.js', 'console.log(1);')
        with mock.patch.object(dependency_module, '_find_npm', return_value='npm'):
            with mock.patch.object(dependency_module.subprocess, 'run') as run:
                result = DependencyScanner(self.workdir).scan()
        run.assert_not_called()
        self.assertTrue(result.get('skipped'))
        self.assertEqual(classify_scan_result(result), 'skipped')

    def test_lockfile_is_audited(self):
        self._write('package.json', '{"name": "demo"}')
        self._write('package-lock.json', '{"lockfileVersion": 3}')
        fake = mock.Mock()
        fake.stdout = json.dumps({'vulnerabilities': {}}).encode()
        fake.stderr = b''
        fake.returncode = 0
        with mock.patch.object(dependency_module, '_find_npm', return_value='npm'):
            with mock.patch.object(dependency_module.subprocess, 'run', return_value=fake) as run:
                result = DependencyScanner(self.workdir).scan()
        run.assert_called_once()
        self.assertEqual(result.get('total_vulnerabilities'), 0)
        self.assertEqual(classify_scan_result(result), 'ok')

    def test_npm_lockfile_error_is_skipped_not_failed(self):
        self._write('package.json', '{"name": "demo"}')
        self._write('package-lock.json', '{}')
        fake = mock.Mock()
        fake.stdout = json.dumps({
            'error': {'summary': 'This command requires an existing lockfile.'}
        }).encode()
        fake.stderr = b''
        fake.returncode = 1
        with mock.patch.object(dependency_module, '_find_npm', return_value='npm'):
            with mock.patch.object(dependency_module.subprocess, 'run', return_value=fake):
                result = DependencyScanner(self.workdir).scan()
        self.assertTrue(result.get('skipped'))
        self.assertEqual(classify_scan_result(result), 'skipped')


# ─────────────────────────────────────────────────────────────────────────────
# Automatic worker start
# ─────────────────────────────────────────────────────────────────────────────

class TempWorkerSlotMixin:
    """
    Point the worker slot lock at a private file.

    The real lock lives in the machine's temp directory and may be held by a
    worker that is really running on this machine — the tests must not
    depend on (or disturb) that.
    """

    def use_temp_slot(self):
        workdir = tempfile.mkdtemp(prefix='codeguard_slot_test_')
        self.addCleanup(shutil.rmtree, workdir, ignore_errors=True)
        lock_file = os.path.join(workdir, 'scan-worker.lock')
        patcher = mock.patch(
            'scans.services.worker_slot.lock_path', return_value=lock_file,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        return lock_file


class WorkerSlotTests(TempWorkerSlotMixin, SimpleTestCase):
    """
    The OS-level single-instance guard of the scan worker.

    Two workers at the same time would requeue each other's running job, so
    the second one has to give up.
    """

    def setUp(self):
        self.use_temp_slot()

    def test_only_one_slot_can_be_held_at_a_time(self):
        first = WorkerSlot()
        second = WorkerSlot()
        self.addCleanup(first.release)
        self.addCleanup(second.release)

        self.assertTrue(first.acquire(timeout=1))
        self.assertFalse(second.acquire(timeout=0.2))

        first.release()
        self.assertTrue(second.acquire(timeout=1))

    def test_probe_reports_whether_a_worker_holds_the_slot(self):
        self.assertTrue(probe_slot())

        slot = WorkerSlot()
        self.addCleanup(slot.release)
        self.assertTrue(slot.acquire(timeout=1))
        self.assertFalse(probe_slot())

        slot.release()
        self.assertTrue(probe_slot())

    def test_slot_is_free_again_after_the_worker_dies(self):
        """
        The lock belongs to the OS, so a crashed worker never leaves a stale
        lock behind — the next worker can start immediately.
        """
        slot = WorkerSlot()
        self.assertTrue(slot.acquire(timeout=1))
        # Simulate a crash: the handle is dropped without releasing it.
        slot._handle.close()
        slot._handle = None

        self.assertTrue(probe_slot())


class WorkerLauncherTests(ScanTestEnvironment, TestCase):
    """``ensure_worker_running`` — the API's on-demand worker start."""

    def setUp(self):
        self.user = User.objects.create_user(
            username=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            email=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            password='StrongPass1!',
        )
        self.project = self.make_project(self.user)
        WorkerHeartbeat.clear()
        # Reset the spawn cooldown so every test starts from scratch.
        worker_launcher._last_spawn_at = 0.0
        self.addCleanup(setattr, worker_launcher, '_last_spawn_at', 0.0)

    def autostart(self, value='1'):
        return mock.patch.dict(
            os.environ, {'CODEGUARD_AUTOSTART_WORKER': value}, clear=False,
        )

    def test_autostart_flag_follows_the_environment(self):
        with self.autostart('1'):
            self.assertTrue(worker_launcher.autostart_enabled())
        with self.autostart('0'):
            self.assertFalse(worker_launcher.autostart_enabled())
        with self.autostart('yes'):
            self.assertTrue(worker_launcher.autostart_enabled())
        with self.autostart('off'):
            self.assertFalse(worker_launcher.autostart_enabled())

    def test_autostart_defaults_to_on_in_debug_and_off_in_production(self):
        env = {k: v for k, v in os.environ.items() if k != 'CODEGUARD_AUTOSTART_WORKER'}
        with mock.patch.dict(os.environ, env, clear=True):
            with override_settings(DEBUG=True):
                self.assertTrue(worker_launcher.autostart_enabled())
            with override_settings(DEBUG=False):
                self.assertFalse(worker_launcher.autostart_enabled())

    def test_no_worker_is_started_when_one_is_already_running(self):
        with self.autostart('1'), \
             mock.patch('scans.services.worker_launcher.probe_slot', return_value=False), \
             mock.patch('scans.services.worker_launcher._spawn_worker') as spawn:
            self.assertTrue(ensure_worker_running('test'))
            spawn.assert_not_called()

    def test_worker_is_started_when_nothing_is_running(self):
        with self.autostart('1'), \
             mock.patch('scans.services.worker_launcher.probe_slot', return_value=True), \
             mock.patch('scans.services.worker_launcher._spawn_worker', return_value=True) as spawn:
            self.assertTrue(ensure_worker_running('test'))
            spawn.assert_called_once()

    def test_a_fresh_heartbeat_means_a_worker_elsewhere_is_alive(self):
        WorkerHeartbeat.beat('worker-on-another-host')
        with self.autostart('1'), \
             mock.patch('scans.services.worker_launcher.probe_slot', return_value=True), \
             mock.patch('scans.services.worker_launcher._spawn_worker') as spawn:
            self.assertTrue(ensure_worker_running('test'))
            spawn.assert_not_called()

    def test_a_stale_heartbeat_of_a_local_worker_does_not_block_a_restart(self):
        """
        A killed worker leaves its heartbeat row behind for up to the
        heartbeat timeout.  The OS lock is authoritative for this machine, so
        the worker must be restarted immediately instead of waiting.
        """
        import socket

        WorkerHeartbeat.beat(f'{socket.gethostname()}:99999')
        with self.autostart('1'), \
             mock.patch('scans.services.worker_launcher.probe_slot', return_value=True), \
             mock.patch('scans.services.worker_launcher._spawn_worker', return_value=True) as spawn:
            self.assertTrue(ensure_worker_running('test'))
            spawn.assert_called_once()

    def test_autostart_can_be_switched_off_entirely(self):
        with self.autostart('0'), \
             mock.patch('scans.services.worker_launcher._spawn_worker') as spawn:
            self.assertFalse(ensure_worker_running('test'))
            spawn.assert_not_called()

    def test_a_failing_spawn_never_raises(self):
        with self.autostart('1'), \
             mock.patch('scans.services.worker_launcher.probe_slot', return_value=True), \
             mock.patch(
                 'scans.services.worker_launcher._spawn_worker',
                 side_effect=OSError('boom'),
             ):
            self.assertFalse(ensure_worker_running('test'))


class AutoStartWorkerApiTests(ScanTestEnvironment, AuthMixin, APITestCase):
    """The API starts a worker by itself — no second terminal required."""

    def setUp(self):
        self.user = self.make_user()
        self.project = self.make_project(self.user)
        self.login(self.user)
        WorkerHeartbeat.clear()

    def start_scan(self):
        return self.client.post(
            '/api/scans/start/',
            {
                'project_id': str(self.project.id),
                'selected_scanners': ['semgrep'],
            },
            format='json',
        )

    def test_starting_a_scan_starts_a_worker(self):
        with mock.patch('scans.views.ensure_worker_running') as ensure:
            res = self.start_scan()

        self.assertEqual(res.status_code, http_status.HTTP_201_CREATED, res.data)
        ensure.assert_called_once()

    def test_polling_a_queued_scan_starts_a_worker(self):
        scan = Scan.objects.create(
            project=self.project, scanners=['semgrep'],
            status='queued', stage='queued', started_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )

        with mock.patch('scans.views.ensure_worker_running') as ensure:
            res = self.client.get(f'/api/scans/{scan.pk}/status/')

        self.assertEqual(res.status_code, http_status.HTTP_200_OK)
        self.assertFalse(res.data['worker_online'])
        ensure.assert_called_once()

    def test_polling_a_finished_scan_does_not_start_a_worker(self):
        scan = Scan.objects.create(
            project=self.project, scanners=['semgrep'],
            status='completed', stage='done', progress=100,
            started_at=timezone.now(), completed_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )

        with mock.patch('scans.views.ensure_worker_running') as ensure:
            res = self.client.get(f'/api/scans/{scan.pk}/status/')

        self.assertEqual(res.status_code, http_status.HTTP_200_OK)
        ensure.assert_not_called()


class WorkerCommandTests(TempWorkerSlotMixin, ScanTestEnvironment, TestCase):
    """``manage.py runscanworker`` — one worker per machine."""

    def setUp(self):
        self.use_temp_slot()
        self.user = User.objects.create_user(
            username=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            email=f'{uuid_mod.uuid4().hex[:10]}@example.com',
            password='StrongPass1!',
        )
        self.project = self.make_project(self.user)
        WorkerHeartbeat.clear()

    def test_a_second_worker_gives_up_without_touching_the_queue(self):
        holder = WorkerSlot()
        self.addCleanup(holder.release)
        self.assertTrue(holder.acquire(timeout=1))

        Scan.objects.create(
            project=self.project, scanners=['semgrep'],
            status='queued', stage='queued', started_at=timezone.now(),
            result={'validation': {'isValid': True}, 'scans': {}},
        )

        with mock.patch(
            'scans.management.commands.runscanworker.DEFAULT_ACQUIRE_TIMEOUT_SECONDS', 0.2,
        ), mock.patch('scans.services.scan_worker.claim_next_scan') as claim:
            from django.core.management import call_command

            call_command('runscanworker', '--once')

        claim.assert_not_called()
        # The running worker's heartbeat must not be cleared by the newcomer.
        self.assertEqual(WorkerHeartbeat.objects.count(), 0)

    def test_heartbeat_is_only_cleared_by_its_owner(self):
        WorkerHeartbeat.beat('worker-a')
        WorkerHeartbeat.clear(worker_id='worker-b')
        self.assertTrue(WorkerHeartbeat.is_online())
        WorkerHeartbeat.clear(worker_id='worker-a')
        self.assertFalse(WorkerHeartbeat.is_online())


# ─────────────────────────────────────────────────────────────────────────────
# Semgrep rule set cache
# ─────────────────────────────────────────────────────────────────────────────

class SemgrepRulesCacheTests(SimpleTestCase):
    """The Semgrep rule set is downloaded once and reused locally."""

    def setUp(self):
        self.cache_dir = tempfile.mkdtemp(prefix='codeguard_semgrep_rules_')
        self.addCleanup(shutil.rmtree, self.cache_dir, ignore_errors=True)
        self.env = mock.patch.dict(
            os.environ, {'CODEGUARD_SEMGREP_RULES_DIR': self.cache_dir},
        )
        self.env.start()
        self.addCleanup(self.env.stop)

        from scans.services import semgrep_rules

        self.module = semgrep_rules
        # The cache directory is resolved once per process — make sure each
        # test gets a fresh one.
        self.module.reset_cache_dir()
        self.addCleanup(self.module.reset_cache_dir)

    def _fake_response(self, payload):
        response = mock.MagicMock()
        response.read.return_value = payload
        response.__enter__ = lambda self_: response
        response.__exit__ = lambda self_, *args: False
        return response

    def test_rules_are_downloaded_once_and_then_reused(self):
        payload = b'rules: ' + b'x' * 60_000

        with mock.patch.object(
            self.module.urllib.request, 'urlopen', return_value=self._fake_response(payload),
        ) as urlopen:
            path = self.module.ensure_local_rules('p/default')
            self.assertTrue(path and os.path.exists(path))

            # A second call must not hit the network again.
            again = self.module.ensure_local_rules('p/default')

        self.assertEqual(again, path)
        self.assertEqual(urlopen.call_count, 1)

    def test_a_truncated_download_is_never_used(self):
        with mock.patch.object(
            self.module.urllib.request, 'urlopen',
            return_value=self._fake_response(b'too small'),
        ):
            path = self.module.ensure_local_rules('p/default')

        self.assertIsNone(path)
        self.assertFalse(os.path.exists(self.module.cached_rules_path('p/default')))

    def test_a_failed_refresh_falls_back_to_the_stale_copy(self):
        payload = b'rules: ' + b'x' * 60_000
        with mock.patch.object(
            self.module.urllib.request, 'urlopen', return_value=self._fake_response(payload),
        ):
            self.module.ensure_local_rules('p/default')

        path = self.module.cached_rules_path('p/default')
        os.utime(path, (0, 0))  # make it look ancient

        with mock.patch.object(
            self.module.urllib.request, 'urlopen', side_effect=OSError('network down'),
        ):
            fallback = self.module.ensure_local_rules('p/default')

        self.assertEqual(fallback, path)

    def test_the_scanner_prefers_the_local_rule_file(self):
        from scans.services import semgrep as semgrep_module

        payload = b'rules: ' + b'x' * 60_000
        with mock.patch.object(
            self.module.urllib.request, 'urlopen', return_value=self._fake_response(payload),
        ):
            local = self.module.ensure_local_rules('p/default')

        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('CODEGUARD_SEMGREP_CONFIG', None)
            self.assertEqual(semgrep_module.rules_config(), local)

    def test_the_scanner_falls_back_to_the_registry_when_no_cache_exists(self):
        from scans.services import semgrep as semgrep_module

        with mock.patch.object(
            semgrep_module, 'ensure_local_rules', return_value=None,
        ):
            self.assertEqual(semgrep_module.rules_config(), 'p/default')


# ─────────────────────────────────────────────────────────────────────────────
# Semgrep scanner
# ─────────────────────────────────────────────────────────────────────────────

class SemgrepScannerTests(SimpleTestCase):
    """The Semgrep scanner runs the tool correctly and reports failures well."""

    def setUp(self):
        from scans.services import semgrep as semgrep_module

        self.module = semgrep_module
        self.project = tempfile.mkdtemp(prefix='codeguard_semgrep_project_')
        self.addCleanup(shutil.rmtree, self.project, ignore_errors=True)

    def _completed(self, payload=None, stderr=b'', returncode=0):
        result = mock.Mock()
        result.stdout = (payload if payload is not None else b'{"results": []}')
        result.stderr = stderr
        result.returncode = returncode
        return result

    def _patch_exe(self):
        return mock.patch.object(self.module, '_find_semgrep', return_value='semgrep.exe')

    def test_findings_are_reported(self):
        payload = json.dumps({
            'results': [
                {'extra': {'severity': 'ERROR'}},
                {'extra': {'severity': 'WARNING'}},
                {'extra': {'severity': 'INFO'}},
            ],
        }).encode()

        with self._patch_exe(), mock.patch.object(
            self.module.subprocess, 'run', return_value=self._completed(payload),
        ):
            result = self.module.SemgrepScanner(self.project).scan()

        self.assertIsNone(result.get('error'))
        self.assertEqual(result['total_vulnerabilities'], 3)
        self.assertEqual(result['severity_counts'], {'INFO': 1, 'WARNING': 1, 'ERROR': 1})

    def test_the_rule_set_is_fetched_from_the_local_cache(self):
        with self._patch_exe(), mock.patch.object(
            self.module, 'rules_config', return_value='/tmp/rules.yaml',
        ), mock.patch.object(
            self.module.subprocess, 'run', return_value=self._completed(),
        ) as run:
            self.module.SemgrepScanner(self.project).scan()

        cmd = run.call_args[0][0]
        self.assertIn('--config', cmd)
        self.assertEqual(cmd[cmd.index('--config') + 1], '/tmp/rules.yaml')
        # No network round trips that could stall the scan.
        self.assertIn('--disable-version-check', cmd)
        self.assertIn('--metrics', cmd)

    def test_the_job_count_can_be_configured(self):
        with mock.patch.dict(os.environ, {'CODEGUARD_SEMGREP_JOBS': '3'}), \
                self._patch_exe(), mock.patch.object(
                    self.module, 'rules_config', return_value='p/default',
                ), mock.patch.object(
                    self.module.subprocess, 'run', return_value=self._completed(),
                ) as run:
            self.module.SemgrepScanner(self.project).scan()

        cmd = run.call_args[0][0]
        self.assertEqual(cmd[cmd.index('--jobs') + 1], '3')

    def test_a_memory_cap_can_be_configured(self):
        # Memory-capped hosts (512 MB free instances) pass a --max-memory cap
        # so an oversized file is skipped instead of tripping the OOM killer.
        with mock.patch.dict(os.environ, {'CODEGUARD_SEMGREP_MAX_MEMORY': '192'}), \
                self._patch_exe(), mock.patch.object(
                    self.module, 'rules_config', return_value='p/default',
                ), mock.patch.object(
                    self.module.subprocess, 'run', return_value=self._completed(),
                ) as run:
            self.module.SemgrepScanner(self.project).scan()

        cmd = run.call_args[0][0]
        self.assertEqual(cmd[cmd.index('--max-memory') + 1], '192')

    def test_a_timeout_is_reported_as_such(self):
        with self._patch_exe(), mock.patch.object(
            self.module, 'rules_config', return_value='p/default',
        ), mock.patch.object(
            self.module.subprocess, 'run',
            side_effect=self.module.subprocess.TimeoutExpired(cmd='semgrep', timeout=300),
        ):
            result = self.module.SemgrepScanner(self.project).scan()

        self.assertIn('timed out', result['error'])
        self.assertNotIn('exit_code', result)

    def test_a_crashed_run_reports_the_exit_code_and_the_error_tail(self):
        stderr = b'FIRST LINE marker\n' + b'progress table noise\n' * 100 + b'\nUnicodeEncodeError: charmap\n'
        with self._patch_exe(), mock.patch.object(
            self.module, 'rules_config', return_value='p/default',
        ), mock.patch.object(
            self.module.subprocess, 'run',
            return_value=self._completed(b'', stderr=stderr, returncode=1),
        ):
            result = self.module.SemgrepScanner(self.project).scan()

        self.assertIn('error', result)
        self.assertEqual(result['exit_code'], 1)
        # The error is at the *end* of stderr — the head is just the progress
        # table and must not hide it.
        self.assertIn('UnicodeEncodeError', result['raw_output'])
        self.assertNotIn('FIRST LINE marker', result['raw_output'])

    def test_a_killed_run_is_explained(self):
        with self._patch_exe(), mock.patch.object(
            self.module, 'rules_config', return_value='p/default',
        ), mock.patch.object(
            self.module.subprocess, 'run',
            return_value=self._completed(b'', stderr=b'', returncode=3221225786),
        ):
            result = self.module.SemgrepScanner(self.project).scan()

        self.assertIn('terminated unexpectedly', result['error'])
        self.assertIn('memory', result['error'])

    def test_a_short_failed_run_is_retried_once(self):
        good = self._completed(b'{"results": []}')
        with self._patch_exe(), mock.patch.object(
            self.module, 'rules_config', return_value='p/default',
        ), mock.patch.object(
            self.module.subprocess, 'run',
            side_effect=[self._completed(b'', stderr=b'boom', returncode=1), good],
        ) as run:
            result = self.module.SemgrepScanner(self.project).scan()

        self.assertEqual(run.call_count, 2)
        self.assertIsNone(result.get('error'))
        self.assertEqual(result['total_vulnerabilities'], 0)


# ─────────────────────────────────────────────────────────────────────────────
# Scan summary: the severity counts and risk score the dashboard shows
# ─────────────────────────────────────────────────────────────────────────────

_UNSET = object()


class ScanSummaryTests(ScanTestEnvironment, AuthMixin, APITestCase):
    """
    The "recent scans" cards of the dashboard show the risk score and the
    critical / high / total counts.  They are derived from the stored scanner
    output by the backend — the API must never report zeroes for a scan that
    really contains findings.
    """

    SCANNER_RESULT = {
        'validation': {'fileCount': 12, 'totalSize': 4096},
        'scans': {
            'semgrep': {
                'all_vulnerabilities': [
                    {
                        'path': 'src/app.js',
                        'start': {'line': 3},
                        'extra': {'severity': 'ERROR', 'message': 'SQL injection'},
                    },
                    {
                        'path': 'src/app.js',
                        'start': {'line': 9},
                        'extra': {'severity': 'WARNING', 'message': 'Weak hash'},
                    },
                ],
            },
            'gitleaks': {
                'all_vulnerabilities': [
                    {
                        'File': 'config.js',
                        'StartLine': 1,
                        'Description': 'AWS Access Key',
                        'Secret': 'AKIAEXAMPLE',
                    },
                ],
            },
            'dependency': {
                'all_vulnerabilities': {
                    'lodash': {'severity': 'high', 'range': '<4.17.21'},
                },
            },
        },
    }

    def make_scan(self, user, result=_UNSET, dismissed=None):
        project = self.make_project(user)
        return Scan.objects.create(
            project=project,
            scanners=['semgrep', 'gitleaks', 'dependency'],
            status='completed',
            stage='done',
            progress=100,
            result=self.SCANNER_RESULT if result is _UNSET else result,
            dismissed_findings=dismissed or [],
        )

    def test_counts_are_derived_from_the_stored_scanner_output(self):
        user = self.make_user()
        scan = self.make_scan(user)

        summary = summarize_scan(scan)

        # semgrep ERROR -> critical, semgrep WARNING -> high,
        # gitleaks -> critical, npm audit "high" -> high
        self.assertEqual(summary['findings']['critical'], 2)
        self.assertEqual(summary['findings']['high'], 2)
        self.assertEqual(summary['findings']['medium'], 0)
        self.assertEqual(summary['findings']['low'], 0)
        self.assertEqual(summary['findings']['total'], 4)
        self.assertEqual(summary['fileCount'], 12)

    def test_risk_score_is_the_weighted_sum_capped_at_100(self):
        user = self.make_user()
        scan = self.make_scan(user)

        summary = summarize_scan(scan)

        # 2 x critical (40) + 2 x high (20) = 120 -> capped at 100
        self.assertEqual(summary['riskScore'], 100)

    def test_risk_score_scales_with_the_findings(self):
        user = self.make_user()
        scan = self.make_scan(user, result={
            'scans': {
                'semgrep': {
                    'all_vulnerabilities': [
                        {
                            'path': 'src/app.js',
                            'start': {'line': 1},
                            'extra': {'severity': 'WARNING', 'message': 'Weak hash'},
                        },
                    ],
                },
            },
        })

        summary = summarize_scan(scan)

        self.assertEqual(summary['findings']['high'], 1)
        self.assertEqual(summary['riskScore'], 20)

    def test_dismissed_findings_are_not_counted_anymore(self):
        user = self.make_user()
        scan = self.make_scan(user, dismissed=['gitleaks_0'])

        summary = summarize_scan(scan)

        self.assertEqual(summary['findings']['critical'], 1)
        self.assertEqual(summary['findings']['total'], 3)

    def test_a_scan_without_results_reports_zeroes(self):
        user = self.make_user()
        scan = self.make_scan(user, result=None)

        summary = summarize_scan(scan)

        self.assertEqual(summary['riskScore'], 0)
        self.assertEqual(summary['findings']['total'], 0)
        self.assertEqual(summary['fileCount'], 0)

    def test_the_api_exposes_the_summary_on_the_scan_list(self):
        user = self.make_user()
        self.login(user)
        self.make_scan(user)

        res = self.client.get('/api/scans/')

        self.assertEqual(res.status_code, http_status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        row = res.data[0]
        self.assertEqual(row['summary']['findings']['critical'], 2)
        self.assertEqual(row['summary']['findings']['high'], 2)
        self.assertEqual(row['summary']['findings']['total'], 4)
        self.assertEqual(row['summary']['riskScore'], 100)


# ─────────────────────────────────────────────────────────────────────────────
# Semgrep offload to GitHub Actions (DEPLOYMENT.md §8)
# ─────────────────────────────────────────────────────────────────────────────

GITHUB_ENV_ON = {
    'CODEGUARD_GITHUB_TOKEN': 'ghp_test_token',
    'CODEGUARD_GITHUB_ACTIONS_REPO': 'octo/repo',
    'CODEGUARD_PUBLIC_API_BASE': 'https://api.example.com',
    'CODEGUARD_SEMGREP_CONFIG': '',
}
GITHUB_ENV_OFF = {name: '' for name in GITHUB_ENV_ON}


class GitHubActionsConfigTests(SimpleTestCase):
    """Remote dispatching activates only when every piece is configured."""

    def test_enabled_needs_token_repository_and_public_base(self):
        from .services import github_actions

        with mock.patch.dict(os.environ, GITHUB_ENV_OFF):
            self.assertFalse(github_actions.enabled())

        with mock.patch.dict(os.environ, GITHUB_ENV_ON):
            self.assertTrue(github_actions.enabled())

        required = ('CODEGUARD_GITHUB_TOKEN', 'CODEGUARD_GITHUB_ACTIONS_REPO',
                    'CODEGUARD_PUBLIC_API_BASE')
        for missing in required:
            partial = dict(GITHUB_ENV_ON, **{missing: ''})
            with mock.patch.dict(os.environ, partial):
                self.assertFalse(github_actions.enabled(), f'{missing} is required')

    def test_remote_configuration_makes_semgrep_available_without_a_local_install(self):
        from .services import semgrep as semgrep_module
        from .services.scanner_runner import reset_scanner_caches, scanner_availability

        reset_scanner_caches()
        self.addCleanup(reset_scanner_caches)
        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(semgrep_module, '_find_semgrep', return_value=None):
            self.assertTrue(semgrep_module.semgrep_available())
            info = scanner_availability(force_refresh=True)['semgrep']

        self.assertTrue(info['available'])
        self.assertIn('GitHub Actions', info['hint'])

    def test_availability_hint_stays_local_when_remote_is_not_configured(self):
        from .services.scanner_runner import reset_scanner_caches, scanner_availability

        reset_scanner_caches()
        self.addCleanup(reset_scanner_caches)
        with mock.patch.dict(os.environ, GITHUB_ENV_OFF):
            info = scanner_availability(force_refresh=True)['semgrep']

        self.assertEqual(info['hint'], 'pip install semgrep')


class RemoteArgumentTests(SimpleTestCase):
    def test_remote_command_args_mirror_the_local_flags(self):
        from .services.semgrep import EXCLUDED_DIRS, _command_args

        args = _command_args('p/default', 2, 5000)

        self.assertEqual(args[args.index('--config') + 1], 'p/default')
        self.assertEqual(args[args.index('--jobs') + 1], '2')
        # Semgrep's own default — the 7 GB runner needs no tight cap.
        self.assertEqual(args[args.index('--max-memory') + 1], '5000')
        for directory in EXCLUDED_DIRS:
            self.assertIn(directory, args)
        self.assertIn('--disable-version-check', args)
        self.assertIn('--metrics', args)

    def test_only_shell_safe_arguments_may_travel_to_the_runner(self):
        from .services.semgrep import _args_are_safe

        self.assertTrue(_args_are_safe(['--config', 'p/default', '--jobs', '2']))
        self.assertFalse(_args_are_safe(['--config', 'p/default; rm -rf /']))
        self.assertFalse(_args_are_safe(['--config', 'p/has space']))
        self.assertFalse(_args_are_safe(['--config', '']))

    def test_a_local_rule_file_can_not_be_used_remotely(self):
        from .services import semgrep as semgrep_module

        with mock.patch.dict(os.environ, {'CODEGUARD_SEMGREP_CONFIG': '/opt/rules.yaml'}):
            self.assertIsNone(semgrep_module._remote_config())
        with mock.patch.dict(os.environ, {'CODEGUARD_SEMGREP_CONFIG': ''}):
            self.assertEqual(semgrep_module._remote_config(), 'p/default')
        with mock.patch.dict(
            os.environ, {'CODEGUARD_SEMGREP_CONFIG': 'https://rules.example.com/r.yaml'},
        ):
            self.assertEqual(semgrep_module._remote_config(), 'https://rules.example.com/r.yaml')


class SemgrepRemoteScanTests(SimpleTestCase):
    """
    With GitHub Actions configured the scanner dispatches remotely and
    touches the local install only as a fallback — enabling the feature
    can never make a scan worse than before.
    """

    def setUp(self):
        from scans.services import semgrep as semgrep_module

        self.module = semgrep_module
        self.project = tempfile.mkdtemp(prefix='codeguard_remote_semgrep_')
        self.addCleanup(shutil.rmtree, self.project, ignore_errors=True)

    def _completed(self, payload=b'{"results": []}', stderr=b'', returncode=0):
        result = mock.Mock()
        result.stdout = payload
        result.stderr = stderr
        result.returncode = returncode
        return result

    def test_remote_success_returns_without_starting_a_local_process(self):
        remote_stdout = json.dumps({
            'results': [{'extra': {'severity': 'ERROR'}}, {'extra': {'severity': 'INFO'}}],
        })
        scanner = self.module.SemgrepScanner(self.project, project=mock.Mock(pk=42))

        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(self.module.github_actions, 'dispatch') as dispatch, \
                mock.patch.object(
                    self.module.github_actions, 'wait_for_result',
                    return_value={
                        'stdout': remote_stdout,
                        'stderr': '',
                        'exit_code': 0,
                        'run_url': 'https://github.com/octo/repo/actions/runs/1',
                    },
                ), \
                mock.patch.object(self.module, '_find_semgrep') as find_exe:
            result = scanner.scan()

        self.assertIsNone(result.get('error'))
        self.assertEqual(result['total_vulnerabilities'], 2)
        self.assertEqual(result['severity_counts'], {'INFO': 1, 'WARNING': 0, 'ERROR': 1})
        self.assertEqual(result['exit_code'], 0)

        kwargs = dispatch.call_args.kwargs
        self.assertTrue(kwargs['archive_url'].startswith(
            'https://api.example.com/api/scans/archive/?token=',
        ))
        self.assertIn('--config p/default', kwargs['args'])
        self.assertIn('--jobs 2', kwargs['args'])
        self.assertTrue(kwargs['scan_id'].startswith('42-'))
        find_exe.assert_not_called()

    def test_a_broken_remote_falls_back_to_the_local_install(self):
        scanner = self.module.SemgrepScanner(self.project, project=mock.Mock(pk=7))

        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(
                    self.module.github_actions, 'dispatch',
                    side_effect=self.module.github_actions.GitHubActionsError('GitHub is down'),
                ), \
                mock.patch.object(self.module, '_find_semgrep', return_value='semgrep.exe'), \
                mock.patch.object(self.module, 'rules_config', return_value='p/default'), \
                mock.patch.object(
                    self.module.subprocess, 'run', return_value=self._completed(),
                ) as run:
            result = scanner.scan()

        self.assertIsNone(result.get('error'))
        self.assertEqual(result['total_vulnerabilities'], 0)
        run.assert_called_once()

    def test_a_broken_remote_without_a_local_install_is_a_real_error(self):
        scanner = self.module.SemgrepScanner(self.project, project=mock.Mock(pk=7))

        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(
                    self.module.github_actions, 'dispatch',
                    side_effect=self.module.github_actions.GitHubActionsError(
                        'token lacks the repo scope',
                    ),
                ), \
                mock.patch.object(self.module, '_find_semgrep', return_value=None):
            result = scanner.scan()

        self.assertIn('repo scope', result['error'])
        # Remote was configured (available) but broke — not a missing tool.
        self.assertFalse(result.get('unavailable'))

    def test_a_failed_fallback_reports_the_remote_error_too(self):
        scanner = self.module.SemgrepScanner(self.project, project=mock.Mock(pk=7))

        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(
                    self.module.github_actions, 'dispatch',
                    side_effect=self.module.github_actions.GitHubActionsError('GitHub is down'),
                ), \
                mock.patch.object(self.module, '_find_semgrep', return_value='semgrep.exe'), \
                mock.patch.object(self.module, 'rules_config', return_value='p/default'), \
                mock.patch.object(
                    self.module.subprocess, 'run',
                    side_effect=self.module.subprocess.TimeoutExpired('semgrep', 300),
                ):
            result = scanner.scan()

        # Both failures are named, otherwise the report hides the real cause.
        self.assertIn('timed out', result['error'])
        self.assertIn('GitHub is down', result['error'])

    def test_unusable_remote_output_is_reported_with_the_stderr_tail(self):
        scanner = self.module.SemgrepScanner(self.project, project=mock.Mock(pk=7))

        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(self.module.github_actions, 'dispatch'), \
                mock.patch.object(
                    self.module.github_actions, 'wait_for_result',
                    return_value={
                        'stdout': 'definitely not json',
                        'stderr': 'scanner exploded',
                        'exit_code': 2,
                        'run_url': 'https://github.com/octo/repo/actions/runs/2',
                    },
                ), \
                mock.patch.object(self.module, '_find_semgrep', return_value=None):
            result = scanner.scan()

        self.assertIn('unusable Semgrep output', result['error'])
        self.assertIn('scanner exploded', result['error'])
        self.assertEqual(result['exit_code'], 2)

    def test_without_a_project_row_the_scan_stays_local(self):
        scanner = self.module.SemgrepScanner(self.project)

        with mock.patch.dict(os.environ, GITHUB_ENV_ON), \
                mock.patch.object(self.module, '_find_semgrep', return_value=None):
            result = scanner.scan()

        self.assertTrue(result.get('unavailable'))

    def test_a_local_rule_config_never_reaches_the_runner(self):
        scanner = self.module.SemgrepScanner(self.project, project=mock.Mock(pk=7))

        with mock.patch.dict(
            os.environ, {**GITHUB_ENV_ON, 'CODEGUARD_SEMGREP_CONFIG': '/opt/rules.yaml'},
        ), \
                mock.patch.object(self.module.github_actions, 'dispatch') as dispatch, \
                mock.patch.object(self.module, '_find_semgrep', return_value=None):
            result = scanner.scan()

        dispatch.assert_not_called()
        self.assertIn('local file', result['error'])


class GitHubActionsProtocolTests(SimpleTestCase):
    """The dispatch / poll / download conversation with GitHub's REST API."""

    ENV = dict(GITHUB_ENV_ON, CODEGUARD_GITHUB_POLL_SECONDS='0.5')

    def _response(self, status_code=200, payload=None, content=b''):
        response = mock.Mock()
        response.status_code = status_code
        response.json.return_value = payload if payload is not None else {}
        response.text = json.dumps(payload) if payload is not None else ''
        response.content = content
        return response

    def _artifact_zip(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('semgrep.json', json.dumps({
                'results': [{'extra': {'severity': 'INFO'}}],
            }))
            archive.writestr('rc.txt', '0')
            archive.writestr('err.txt', '')
        return buffer.getvalue()

    def _now_iso(self):
        from datetime import datetime, timezone as utc_timezone
        return datetime.now(utc_timezone.utc).isoformat().replace('+00:00', 'Z')

    def test_dispatch_queues_the_workflow_with_the_scan_inputs(self):
        from .services import github_actions

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(
                    github_actions.requests, 'post', return_value=self._response(204),
                ) as post:
            github_actions.dispatch(
                scan_id='5-123',
                archive_url='https://api.example.com/api/scans/archive/?token=abc',
                args='--json --config p/default',
            )

        self.assertIn(
            '/repos/octo/repo/actions/workflows/semgrep-scan.yml/dispatches',
            post.call_args[0][0],
        )
        self.assertEqual(
            post.call_args[1]['headers']['Authorization'],
            'Bearer ghp_test_token',
        )
        self.assertEqual(post.call_args[1]['json'], {
            'ref': 'main',
            'inputs': {
                'scan_id': '5-123',
                'archive_url': 'https://api.example.com/api/scans/archive/?token=abc',
                'args': '--json --config p/default',
            },
        })

    def test_a_missing_workflow_file_is_explained(self):
        from .services import github_actions

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(
                    github_actions.requests, 'post', return_value=self._response(404),
                ):
            with self.assertRaises(github_actions.GitHubActionsError) as ctx:
                github_actions.dispatch('5-123', 'u', 'a')

        self.assertIn('pushed to the default branch', str(ctx.exception))

    def test_wait_downloads_the_artifact_and_returns_the_payload(self):
        from .services import github_actions

        run = {
            'id': 77,
            'status': 'completed',
            'conclusion': 'success',
            'html_url': 'https://github.com/octo/repo/actions/runs/77',
        }
        listed = dict(
            run, name='CodeGuard Semgrep scan',
            display_title='CodeGuard scan 5-123', created_at=self._now_iso(),
        )
        responses = [
            self._response(200, {'workflow_runs': [listed]}),
            self._response(200, run),
            self._response(200, {'artifacts': [{
                'name': 'semgrep-output',
                'expired': False,
                'archive_download_url': 'https://api.github.com/artifacts/1/zip',
            }]}),
            self._response(200, content=self._artifact_zip()),
        ]

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(
                    github_actions.requests, 'get', side_effect=responses,
                ) as get:
            payload = github_actions.wait_for_result('5-123', timeout_seconds=30)

        self.assertEqual(payload['exit_code'], 0)
        self.assertEqual(
            json.loads(payload['stdout'])['results'][0]['extra']['severity'], 'INFO',
        )
        self.assertEqual(payload['run_url'], 'https://github.com/octo/repo/actions/runs/77')
        self.assertEqual(get.call_count, 4)
        # The first call lists runs of *this* workflow only, so a second
        # workflow in the repository could never hijack the poll.
        self.assertIn(
            '/repos/octo/repo/actions/workflows/semgrep-scan.yml/runs',
            get.call_args_list[0][0][0],
        )

    def test_a_failed_run_reports_its_url(self):
        from .services import github_actions

        run = {
            'id': 78,
            'status': 'completed',
            'conclusion': 'failure',
            'html_url': 'https://github.com/octo/repo/actions/runs/78',
        }
        listed = dict(
            run, name='CodeGuard Semgrep scan',
            display_title='CodeGuard scan 5-124', created_at=self._now_iso(),
        )
        responses = [
            self._response(200, {'workflow_runs': [listed]}),
            self._response(200, run),
        ]

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(github_actions.requests, 'get', side_effect=responses):
            with self.assertRaises(github_actions.GitHubActionsError) as ctx:
                github_actions.wait_for_result('5-124', timeout_seconds=30)

        message = str(ctx.exception)
        self.assertIn('failure', message)
        self.assertIn('actions/runs/78', message)

    def test_a_late_artifact_is_retried(self):
        from .services import github_actions

        run = {
            'id': 80,
            'status': 'completed',
            'conclusion': 'success',
            'html_url': 'https://github.com/octo/repo/actions/runs/80',
        }
        listed = dict(
            run, name='CodeGuard Semgrep scan',
            display_title='CodeGuard scan 5-126', created_at=self._now_iso(),
        )
        responses = [
            self._response(200, {'workflow_runs': [listed]}),
            self._response(200, run),
            # The artifacts endpoint lags the "completed" status by a beat.
            self._response(200, {'artifacts': []}),
            self._response(200, {'artifacts': [{
                'name': 'semgrep-output',
                'expired': False,
                'archive_download_url': 'https://api.github.com/artifacts/2/zip',
            }]}),
            self._response(200, content=self._artifact_zip()),
        ]

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(
                    github_actions.requests, 'get', side_effect=responses,
                ), \
                mock.patch.object(github_actions.time, 'sleep'):
            payload = github_actions.wait_for_result('5-126', timeout_seconds=30)

        self.assertEqual(payload['exit_code'], 0)
        self.assertIn('results', json.loads(payload['stdout']))

    def test_an_artifact_without_the_expected_file_is_an_error(self):
        from .services import github_actions

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('rc.txt', '0')
            archive.writestr('err.txt', '')
        run = {
            'id': 81,
            'status': 'completed',
            'conclusion': 'success',
            'html_url': 'https://github.com/octo/repo/actions/runs/81',
        }
        responses = [
            self._response(200, {'workflow_runs': [dict(
                run, name='CodeGuard Semgrep scan',
                display_title='CodeGuard scan 5-127', created_at=self._now_iso(),
            )]}),
            self._response(200, run),
            self._response(200, {'artifacts': [{
                'name': 'semgrep-output',
                'expired': False,
                'archive_download_url': 'https://api.github.com/artifacts/3/zip',
            }]}),
            self._response(200, content=buffer.getvalue()),
        ]

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(github_actions.requests, 'get', side_effect=responses):
            with self.assertRaises(github_actions.GitHubActionsError) as ctx:
                github_actions.wait_for_result('5-127', timeout_seconds=30)

        # A silently empty result would surface as a bogus "no findings".
        self.assertIn('semgrep.json', str(ctx.exception))

    def test_waiting_gives_up_after_the_timeout(self):
        from .services import github_actions

        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch.object(
                    github_actions.requests, 'get',
                    return_value=self._response(200, {'workflow_runs': []}),
                ), \
                mock.patch.object(github_actions.time, 'sleep'), \
                mock.patch.object(
                    github_actions.time, 'monotonic', side_effect=[1000.0, 1040.0],
                ):
            with self.assertRaises(github_actions.GitHubActionsError) as ctx:
                github_actions.wait_for_result('5-125', timeout_seconds=30)

        self.assertIn('Timed out', str(ctx.exception))


class ArchiveLinkTests(ScanTestEnvironment, TestCase):
    """Signed archive links: mintable by the worker, verifiable statelessly,
    dead once they expire."""

    BASE_ENV = {
        'CODEGUARD_PUBLIC_API_BASE': 'https://api.example.com',
        'CODEGUARD_ARCHIVE_TOKEN_MAX_AGE': '900',
    }

    def setUp(self):
        patcher = mock.patch.dict(os.environ, self.BASE_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _project(self):
        suffix = uuid_mod.uuid4().hex[:10]
        owner = User.objects.create_user(
            username=f'{suffix}@example.com', email=f'{suffix}@example.com', password='x',
        )
        return self.make_project(owner)

    def _token(self, project):
        """The decoded token, exactly what the API endpoint receives."""
        from urllib.parse import unquote
        from .services.archive_link import build_archive_url
        return unquote(build_archive_url(project).split('token=', 1)[1])

    def test_round_trip_mint_and_resolve(self):
        from .services.archive_link import build_archive_url, resolve_project

        project = self._project()
        url = build_archive_url(project)

        self.assertTrue(url.startswith(
            'https://api.example.com/api/scans/archive/?token=',
        ))
        resolved = resolve_project(self._token(project))
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, project.pk)

    def test_no_public_base_yields_no_url(self):
        from .services.archive_link import build_archive_url

        project = self._project()
        with mock.patch.dict(os.environ, {'CODEGUARD_PUBLIC_API_BASE': ''}):
            self.assertIsNone(build_archive_url(project))

    def test_tampered_and_garbage_tokens_resolve_to_nothing(self):
        from .services.archive_link import resolve_project

        project = self._project()
        token = self._token(project)

        self.assertIsNone(resolve_project(''))
        self.assertIsNone(resolve_project(None))
        self.assertIsNone(resolve_project('not-a-token'))
        self.assertIsNone(resolve_project(token + 'tampered'))

    def test_an_expired_token_resolves_to_nothing(self):
        from .services.archive_link import resolve_project

        project = self._project()
        token = self._token(project)

        with mock.patch.dict(os.environ, {'CODEGUARD_ARCHIVE_TOKEN_MAX_AGE': '-1'}):
            self.assertIsNone(resolve_project(token))


class ArchiveDownloadEndpointTests(ScanTestEnvironment, TestCase):
    """``GET /api/scans/archive/?token=…`` streams the ZIP to the GitHub
    runner — and answers 404 for anything else."""

    BASE_ENV = {
        'CODEGUARD_PUBLIC_API_BASE': 'https://api.example.com',
        'CODEGUARD_ARCHIVE_TOKEN_MAX_AGE': '900',
    }

    def setUp(self):
        patcher = mock.patch.dict(os.environ, self.BASE_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _project(self, **kwargs):
        suffix = uuid_mod.uuid4().hex[:10]
        owner = User.objects.create_user(
            username=f'{suffix}@example.com', email=f'{suffix}@example.com', password='x',
        )
        if kwargs:
            return Project.objects.create(owner=owner, **kwargs)
        return self.make_project(owner)

    def _path(self, project):
        from .services.archive_link import build_archive_url
        return build_archive_url(project).split('https://api.example.com', 1)[1]

    def test_a_valid_token_streams_the_archive(self):
        project = self._project()

        response = self.client.get(self._path(project))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')
        self.assertIn('attachment', response['Content-Disposition'])
        self.assertEqual(b''.join(response.streaming_content), VALID_ZIP_BYTES)

    def test_missing_garbage_or_expired_tokens_are_404(self):
        project = self._project()
        path = self._path(project)

        self.assertEqual(self.client.get('/api/scans/archive/').status_code, 404)
        self.assertEqual(
            self.client.get('/api/scans/archive/?token=garbage').status_code, 404,
        )
        with mock.patch.dict(os.environ, {'CODEGUARD_ARCHIVE_TOKEN_MAX_AGE': '-1'}):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_a_project_whose_upload_never_landed_is_404(self):
        project = self._project(name='no-zip', zip_file='')

        self.assertEqual(self.client.get(self._path(project)).status_code, 404)


class ScannerRunnerProjectPassthroughTests(SimpleTestCase):
    """The Project row reaches the Semgrep scanner (GitHub Actions needs it
    for the signed archive link) and no other scanner."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix='codeguard_runner_kwargs_')
        self.addCleanup(shutil.rmtree, self.temp_dir, ignore_errors=True)

    def test_only_semgrep_receives_the_project(self):
        captured = {}

        class StubSemgrep:
            def __init__(self, project_path, project=None):
                captured['semgrep_project'] = project

            def scan(self):
                return {'total_vulnerabilities': 0}

        class StubGitleaks:
            # Deliberately no ``project`` keyword: passing one would raise.
            def __init__(self, project_path):
                captured['gitleaks_path'] = project_path

            def scan(self):
                return {'total_vulnerabilities': 0}

        sentinel = object()
        original_map = ScannerRunner.SCANNER_MAP
        ScannerRunner.SCANNER_MAP = {'semgrep': StubSemgrep, 'gitleaks': StubGitleaks}
        try:
            results = ScannerRunner(
                self.temp_dir, ['gitleaks', 'semgrep'], project=sentinel,
            ).run_all()
        finally:
            ScannerRunner.SCANNER_MAP = original_map

        self.assertIs(captured['semgrep_project'], sentinel)
        self.assertEqual(captured['gitleaks_path'], self.temp_dir)
        self.assertEqual(classify_scan_result(results['semgrep']), 'ok')
        self.assertEqual(classify_scan_result(results['gitleaks']), 'ok')

    def test_without_a_project_row_nothing_changes(self):
        captured = {}

        class StubSemgrep:
            def __init__(self, project_path, project=None):
                captured['semgrep_project'] = project

            def scan(self):
                return {'total_vulnerabilities': 0}

        original_map = ScannerRunner.SCANNER_MAP
        ScannerRunner.SCANNER_MAP = {'semgrep': StubSemgrep}
        try:
            results = ScannerRunner(self.temp_dir, ['semgrep']).run_all()
        finally:
            ScannerRunner.SCANNER_MAP = original_map

        self.assertIsNone(captured['semgrep_project'])
        self.assertEqual(classify_scan_result(results['semgrep']), 'ok')
