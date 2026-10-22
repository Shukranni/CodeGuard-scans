"""
Background scan worker for CodeGuard.

Usage:
    python manage.py runscanworker            # run forever (production/dev)
    python manage.py runscanworker --once     # drain the queue, then exit
    python manage.py runscanworker --poll-interval 1
    python manage.py runscanworker --idle-timeout 600

The worker is a separate, managed process — it refreshes a heartbeat so the
API can report "queued, waiting for a worker" when no worker is online,
recovers jobs interrupted by a previous crash/restart, and fails stale jobs
so no scan can remain in a non-terminal state forever.

Only one worker may run per machine: the process holds an OS-level lock
(``scans.services.worker_slot``) for its whole lifetime.  A second worker
exits immediately instead of competing for the queue.

The API can start a worker on demand — see
``scans.services.worker_launcher.ensure_worker_running``.
"""
import logging
import signal
import sys
import threading
import time

from django.core.management.base import BaseCommand

from scans.models import WorkerHeartbeat
from scans.services.scan_worker import (
    HEARTBEAT_TIMEOUT_SECONDS,
    IDLE_TIMEOUT_SECONDS,
    POLL_INTERVAL_SECONDS,
    claim_next_scan,
    make_worker_id,
    process_scan,
    recover_interrupted_scans,
    sweep_stale_scans,
)
from scans.services.scanner_runner import scanner_availability
from scans.services.semgrep_rules import prewarm_rules
from scans.services.worker_slot import (
    DEFAULT_ACQUIRE_TIMEOUT_SECONDS,
    WorkerSlot,
)

logger = logging.getLogger('scans.worker')


class Command(BaseCommand):
    help = 'Run the CodeGuard background scan worker (claims queued scans and executes scanners).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--poll-interval',
            type=float,
            default=POLL_INTERVAL_SECONDS,
            help='Seconds to wait between polls for queued scans (default: %(default)s).',
        )
        parser.add_argument(
            '--once',
            action='store_true',
            help='Process all currently queued scans and exit instead of looping forever.',
        )
        parser.add_argument(
            '--idle-timeout',
            type=float,
            default=IDLE_TIMEOUT_SECONDS,
            help=(
                'Exit after this many seconds without claiming a scan (0 = never). '
                'Auto-started workers use this to shut themselves down again.'
            ),
        )

    def handle(self, *args, **options):
        poll_interval = max(options['poll_interval'], 0.1)
        run_once = options['once']
        idle_timeout = max(options['idle_timeout'] or 0, 0)
        worker_id = make_worker_id()
        stopping = {'flag': False}

        def _shutdown(signum, frame):
            # Finish the current scan, then exit cleanly.
            stopping['flag'] = True
            self.stdout.write('Shutdown requested — finishing current job…')

        signal.signal(signal.SIGINT, _shutdown)
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, _shutdown)

        # Single-instance guard: only one worker may run per machine.  The lock
        # is owned by the OS, so a crashed worker never leaves a stale lock
        # behind.  A second worker would requeue the job of the first one.
        slot = WorkerSlot()
        if not slot.acquire(timeout=DEFAULT_ACQUIRE_TIMEOUT_SECONDS):
            self.stdout.write(self.style.WARNING(
                'Another scan worker is already running — nothing to do.'
            ))
            return

        self.stdout.write(self.style.SUCCESS(f'Scan worker {worker_id} starting…'))

        # Diagnostics: report missing tools once at startup instead of
        # rediscovering them for every scan.
        availability = scanner_availability(force_refresh=True)
        for name, info in availability.items():
            state = 'available' if info['available'] else 'MISSING'
            line = f'  scanner {name}: {state}'
            if not info['available']:
                line += f'  (install: {info["hint"]})'
            self.stdout.write(line)
            if not info['available']:
                logger.warning('Scanner %s is unavailable — %s', name, info['hint'])

        # Fetch the Semgrep rule set in the background.  Without a local copy
        # Semgrep downloads ~2.5 MB from semgrep.dev on *every* scan, which on
        # a slow connection regularly takes longer than the scan itself.
        def _prewarm_rules():
            try:
                path = prewarm_rules()
                if path:
                    logger.info('Semgrep rules cached at %s', path)
            except Exception as exc:  # pragma: no cover - best effort only
                logger.warning('Could not pre-cache the Semgrep rules: %s', exc)

        threading.Thread(target=_prewarm_rules, daemon=True).start()

        # Take over the heartbeat row of a previous (dead) worker.  Startup
        # recovery must not trust a stale heartbeat: after a crash the previous
        # worker's row can still look fresh and would strand its jobs.
        WorkerHeartbeat.beat(worker_id)
        recovered = recover_interrupted_scans(requeue_all=True)
        if recovered:
            self.stdout.write(self.style.WARNING(f'Requeued {recovered} interrupted scan(s).'))

        last_housekeeping = time.monotonic()
        last_activity = time.monotonic()
        processed = 0

        try:
            while not stopping['flag']:
                WorkerHeartbeat.beat(worker_id)

                if time.monotonic() - last_housekeeping >= max(poll_interval * 5, 30):
                    sweep_stale_scans()
                    last_housekeeping = time.monotonic()

                scan = claim_next_scan(worker_id)
                if scan is None:
                    if run_once:
                        break
                    idle_for = time.monotonic() - last_activity
                    if idle_timeout and idle_for >= idle_timeout:
                        self.stdout.write(self.style.WARNING(
                            f'No scan for {int(idle_for)}s — the worker shuts itself down.'
                        ))
                        break
                    time.sleep(poll_interval)
                    continue

                last_activity = time.monotonic()
                process_scan(scan.pk, worker_id)
                processed += 1
        except KeyboardInterrupt:
            pass
        finally:
            # Make the worker appear offline immediately so the frontend can
            # tell users that queued scans are waiting for a worker.  Only our
            # own heartbeat row is removed — a worker on another host must
            # stay visible.
            WorkerHeartbeat.clear(worker_id=worker_id)
            slot.release()
            self.stdout.write(self.style.SUCCESS(
                f'Scan worker {worker_id} stopped after {processed} scan(s).'
            ))

        sys.exit(0)
