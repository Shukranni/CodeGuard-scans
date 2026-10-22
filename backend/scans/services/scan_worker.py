"""
Background scan execution.

The Scan row itself is the queue: ``POST /api/scans/start`` creates a row
with status ``queued`` and returns immediately; a separate worker process
(``python manage.py runscanworker``) claims queued rows atomically and runs
the scanners.

Guarantees:
  * A scan can only be claimed once (conditional UPDATE on status).
  * Every execution path ends in a terminal status (completed /
    completed_with_warnings / failed) — no scan is left forever in
    ``preparing`` or ``running``.
  * Partial results are persisted as each scanner finishes.
  * Interrupted jobs (worker restart/crash) are recovered on worker start.
  * Temporary extraction directories are always cleaned up.
"""
import logging
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from projects.utils.zip_validator import (
    InvalidZipArchive,
    inspect_zip,
    safe_extract_zip,
)
from projects.utils.archive import local_archive_path
from ..models import Scan, WorkerHeartbeat
from .scanner_runner import ScannerRunner, classify_scan_result

logger = logging.getLogger('scans.worker')

# ── Tunables (override with environment variables) ────────────────────────────
POLL_INTERVAL_SECONDS = float(os.environ.get('SCAN_WORKER_POLL_INTERVAL', '2'))
# A non-terminal scan whose row has not been touched for this long is
# considered interrupted.  Must comfortably exceed the per-scanner timeout
# (the Semgrep timeout scales with the project size and can reach 900s)
# because the row is only touched between scanners.
STALE_SCAN_TIMEOUT_SECONDS = float(os.environ.get('SCAN_STALE_TIMEOUT', '1800'))
# How long a worker heartbeat stays "fresh".
HEARTBEAT_TIMEOUT_SECONDS = float(os.environ.get('SCAN_WORKER_HEARTBEAT_TIMEOUT', '30'))
# Seconds a worker may stay idle (without claiming a scan) before it shuts
# itself down.  0 keeps the worker alive forever.  Auto-started workers pass
# their own value on the command line.
IDLE_TIMEOUT_SECONDS = float(os.environ.get('SCAN_WORKER_IDLE_TIMEOUT', '0'))

TERMINAL_ERROR_LIMIT = 4000


def make_worker_id():
    return f'{socket.gethostname()}:{os.getpid()}'


def worker_host(worker_id):
    """
    The host part of a worker id (``host:pid``).

    Used to tell a worker on *this* machine apart from one on another host.
    """
    if not worker_id:
        return ''
    worker_id = str(worker_id)
    if ':' in worker_id:
        return worker_id.rsplit(':', 1)[0]
    return worker_id


def public_error(message):
    """
    Sanitise a stored error for API responses: strip server filesystem
    paths and truncate.  The raw detail stays in the database for debugging.
    """
    if not message:
        return ''
    scrubbed = str(message)
    replacements = []
    try:
        replacements.append(tempfile.gettempdir())
    except Exception:
        pass
    for base in (getattr(settings, 'BASE_DIR', None), getattr(settings, 'MEDIA_ROOT', None)):
        if base:
            replacements.append(str(base))
    for base in replacements:
        if base:
            scrubbed = scrubbed.replace(base, '[path]')
    return scrubbed[:500]


def _scanner_error_summary(scan_results, partial=True, detail_limit=200):
    """
    Build the message stored on a scan that did not fully succeed.

    It names the failing scanners *and* says why they failed — "semgrep" on
    its own leaves the user guessing.  The detail is shortened so the
    message stays readable.
    """
    failing = []
    for name, result in scan_results.items():
        if classify_scan_result(result) != 'error':
            continue
        detail = ' '.join(str((result or {}).get('error') or 'unknown error').split())
        if len(detail) > detail_limit:
            detail = detail[:detail_limit - 1].rstrip() + '…'
        failing.append(f'{name} ({detail})')

    if not failing:
        return 'Some scanners could not complete.' if partial else 'All scanners failed to execute.'

    if partial:
        return f'Some scanners could not complete: {", ".join(failing)}.'
    return f'All scanners failed to execute: {", ".join(failing)}.'


def _tests_are_running():
    """
    True while the Django test suite is running.

    The test database is an in-memory SQLite file, which every connection
    gets its own copy of — a background thread would therefore write to an
    empty database.  The heartbeat is not needed in tests.
    """
    if 'PYTEST_CURRENT_TEST' in os.environ:
        return True
    return any('test' in str(arg) for arg in sys.argv[:2])


def _heartbeat_loop(worker_id, stop_event):
    """
    Refresh the worker heartbeat until ``stop_event`` is set.

    A scan can take minutes, but the heartbeat is normally only refreshed
    between scans.  Without this thread the API would report the worker as
    offline for the whole duration of a long scan.
    """
    interval = max(5.0, HEARTBEAT_TIMEOUT_SECONDS / 3)
    while not stop_event.wait(interval):
        try:
            WorkerHeartbeat.beat(worker_id)
        except Exception:  # noqa: BLE001 — a heartbeat failure must not kill the scan
            logger.warning('Could not refresh the worker heartbeat', exc_info=True)


# ── Queue operations ──────────────────────────────────────────────────────────

def claim_next_scan(worker_id):
    """
    Atomically claim the oldest queued scan.

    The conditional UPDATE (``status='queued'`` → ``status='preparing'``)
    guarantees that two workers can never claim the same scan.
    """
    candidate_ids = list(
        Scan.objects.filter(status__in=('queued', 'pending'))
        .order_by('started_at')
        .values_list('pk', flat=True)[:5]
    )
    for scan_id in candidate_ids:
        claimed = Scan.objects.filter(
            pk=scan_id, status__in=('queued', 'pending')
        ).update(
            status='preparing',
            stage='validating_archive',
            worker_id=worker_id,
            error='',
            started_at=timezone.now(),
            updated_at=timezone.now(),
        )
        if claimed:
            logger.info('Worker %s claimed scan %s', worker_id, scan_id)
            return Scan.objects.get(pk=scan_id)
    return None


def _save(scan, **fields):
    for name, value in fields.items():
        setattr(scan, name, value)
    # auto_now updated_at needs an explicit refresh when save() is used
    scan.save()
    return scan


def _fail(scan, message):
    """Move a scan to the terminal ``failed`` state with a recorded error."""
    detail = (message or 'Scan failed for an unknown reason.')[:TERMINAL_ERROR_LIMIT]
    _save(
        scan,
        status='failed',
        stage='failed',
        error=detail,
        completed_at=timezone.now(),
    )
    logger.error('Scan %s failed: %s', scan.pk, detail)


# ── Execution ─────────────────────────────────────────────────────────────────

def process_scan(scan_id, worker_id):
    """
    Run the full pipeline for a claimed scan:

        validating archive → extracting → running scanners → persisting results

    Always terminates in a terminal status, even on unexpected exceptions.
    """
    try:
        scan = Scan.objects.get(pk=scan_id)
    except Scan.DoesNotExist:
        logger.warning('Scan %s disappeared before processing', scan_id)
        return

    if scan.worker_id != worker_id or scan.status not in ('preparing', 'running'):
        # Another worker owns it (or it already finished) — do nothing.
        logger.info('Scan %s is not owned by worker %s; skipping', scan_id, worker_id)
        return

    if not scan.scanners:
        _fail(scan, 'No scanners were selected for this scan.')
        return

    extract_dir = None
    # A scan can run for minutes (Semgrep analyses every file), but the
    # heartbeat is only refreshed between scans.  Without this the API would
    # report the worker as offline while it is happily working.
    stop_heartbeat = threading.Event()
    if not _tests_are_running():
        threading.Thread(
            target=_heartbeat_loop, args=(worker_id, stop_heartbeat), daemon=True,
        ).start()
    try:
        # ``local_archive_path`` yields a real path on disk: the uploaded file
        # itself for local storage, or a temporary copy for remote storage.
        with local_archive_path(scan.project) as zip_path:

            # 1. Validate the archive (central directory only — cheap).
            validation = inspect_zip(zip_path)
            _save(
                scan,
                stage='extracting',
                result={'validation': validation, 'scans': {}},
            )

            # 2. Extract safely into a per-scan temporary directory.
            extract_dir = tempfile.mkdtemp(prefix='codeguard_scan_')
            safe_extract_zip(zip_path, extract_dir)

            # 3. Run the scanners.
            _save(scan, status='running', stage='running', progress=0)

            def on_progress(event, scanner_name, result, completed, total):
                # Persist partial results after every scanner so an interruption
                # never loses completed work.
                progress = int(round((completed / max(total, 1)) * 100))
                current = Scan.objects.get(pk=scan_id)
                scans_data = dict((current.result or {}).get('scans') or {})
                if event == 'finished' and result is not None:
                    scans_data[scanner_name] = result
                stage = f'running:{scanner_name}' if event == 'started' else 'running'
                _save(
                    current,
                    stage=stage,
                    progress=min(progress, 99),  # 100 is only set on completion
                    result={'validation': validation, 'scans': scans_data},
                )

            runner = ScannerRunner(extract_dir, scan.scanners)
            scan_results = runner.run_all(on_progress=on_progress)

            # 4. Classify outcomes and choose the terminal status.
            outcomes = [classify_scan_result(r) for r in scan_results.values()]
            succeeded = sum(1 for o in outcomes if o in ('ok', 'skipped'))
            failed = sum(1 for o in outcomes if o == 'error')

            if failed == 0:
                final_status = 'completed'
                final_error = ''
            elif succeeded > 0:
                final_status = 'completed_with_warnings'
                final_error = _scanner_error_summary(scan_results, partial=True)
            else:
                final_status = 'failed'
                final_error = _scanner_error_summary(scan_results, partial=False)

            terminal_stage = 'done' if final_status != 'failed' else 'failed'
            _save(
                scan,
                status=final_status,
                stage=terminal_stage,
                progress=100,
                error=final_error,
                completed_at=timezone.now(),
                result={'validation': validation, 'scans': scan_results},
            )
            logger.info('Scan %s finished with status=%s', scan_id, final_status)

    except InvalidZipArchive as exc:
        _fail(scan, f'Invalid ZIP archive: {exc}')
    except FileNotFoundError as exc:
        _fail(scan, f'Project archive missing on server: {exc}')
    except Exception as exc:  # noqa: BLE001 — must always reach a terminal state
        logger.exception('Scan %s crashed', scan_id)
        _fail(scan, f'Unexpected error while running the scan: {exc}')
    finally:
        stop_heartbeat.set()
        if extract_dir:
            shutil.rmtree(extract_dir, ignore_errors=True)


def run_single_scan(scan_id, worker_id=None):
    """
    Claim (if needed) and process one scan synchronously.

    Used by tests and by ``manage.py runscanworker --once``.
    """
    worker_id = worker_id or make_worker_id()
    scan = Scan.objects.filter(pk=scan_id).first()
    if scan is None:
        return None
    if scan.status in ('queued', 'pending'):
        # Claim THIS scan directly (never a different, older job).
        updated = Scan.objects.filter(pk=scan_id, status__in=('queued', 'pending')).update(
            status='preparing',
            stage='validating_archive',
            worker_id=worker_id,
            error='',
            updated_at=timezone.now(),
        )
        if not updated:
            # Already claimed by another worker or already finished.
            return Scan.objects.get(pk=scan_id)
    process_scan(scan_id, worker_id)
    return Scan.objects.get(pk=scan_id)


# ── Recovery & housekeeping ───────────────────────────────────────────────────

def sweep_stale_scans():
    """
    Fail any non-terminal scan that has not been touched for longer than
    ``STALE_SCAN_TIMEOUT_SECONDS`` so users never wait forever on a
    scan whose job was lost.
    """
    cutoff = timezone.now() - timedelta(seconds=STALE_SCAN_TIMEOUT_SECONDS)
    stale = Scan.objects.filter(status__in=Scan.ACTIVE_STATUSES, updated_at__lt=cutoff)
    for scan in stale:
        _fail(
            scan,
            'Scan was interrupted or timed out before it could finish. '
            'Please retry the scan.',
        )


def worker_is_live(max_age_seconds=None):
    """True only when a worker heartbeat is *currently* fresh."""
    return WorkerHeartbeat.is_online(
        max_age_seconds=max_age_seconds or HEARTBEAT_TIMEOUT_SECONDS,
    )


def recover_interrupted_scans(requeue_all=False):
    """
    Handle jobs left in ``preparing``/``running`` by a dead worker.

    * ``requeue_all=True`` — called at worker **startup**.  Any interrupted
      job belonged to a previous, now-gone worker (this fresh worker has not
      claimed anything yet), so requeue immediately.  This deliberately does
      not trust the heartbeat row: after a crash/SIGKILL the row can still be
      within its freshness window and would otherwise strand the job.
    * ``requeue_all=False`` — periodic housekeeping.  Only requeue jobs that
      are also STALE, so a live worker never has its running job stolen.

    Stale jobs that no worker recovers are eventually failed by
    :func:`sweep_stale_scans`.
    """
    interrupted = Scan.objects.filter(status__in=('preparing', 'running'))
    if not interrupted.exists():
        return 0

    if not requeue_all and worker_is_live():
        cutoff = timezone.now() - timedelta(seconds=STALE_SCAN_TIMEOUT_SECONDS)
        interrupted = interrupted.filter(updated_at__lt=cutoff)

    requeued = 0
    for scan in interrupted.iterator():
        logger.warning('Requeuing interrupted scan %s (was %s)', scan.pk, scan.status)
        _save(
            scan,
            status='queued',
            stage='queued',
            worker_id='',
            error='Requeued automatically after a worker restart.',
            updated_at=timezone.now(),
        )
        requeued += 1
    return requeued


def scan_worker_snapshot(scan):
    """Build the lightweight status payload returned by the status endpoint."""
    scans_data = ((scan.result or {}).get('scans') or {})
    scanner_status = {}
    for name in scan.scanners or []:
        if name in scans_data:
            outcome = classify_scan_result(scans_data[name])
            scanner_status[name] = {
                'ok': 'completed',
                'skipped': 'skipped',
                'error': 'failed',
            }[outcome]
        elif scan.status == 'running' and scan.stage == f'running:{name}':
            scanner_status[name] = 'running'
        elif scan.status in ('completed', 'completed_with_warnings'):
            scanner_status[name] = 'completed'
        else:
            scanner_status[name] = 'pending'

    return {
        'id': scan.id,
        'project': scan.project_id,
        'project_name': scan.project.name,
        'status': scan.status,
        'stage': scan.stage,
        'progress': scan.progress,
        'scanners': scan.scanners or [],
        'scanner_status': scanner_status,
        'started_at': scan.started_at,
        'completed_at': scan.completed_at,
        'updated_at': scan.updated_at,
        'error': public_error(scan.error),
        'is_terminal': scan.status in Scan.TERMINAL_STATUSES,
        'worker_online': WorkerHeartbeat.is_online(max_age_seconds=HEARTBEAT_TIMEOUT_SECONDS),
        'has_results': bool(scan.result and (scan.result.get('scans'))),
    }


def wait_for_queued_scan(worker_id, timeout=10.0):
    """Utility for tests: process queued scans until none remain or timeout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        scan = claim_next_scan(worker_id)
        if scan is None:
            return
        process_scan(scan.pk, worker_id)
