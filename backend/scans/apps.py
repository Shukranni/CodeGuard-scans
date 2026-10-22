"""
App configuration for the scans app.

Besides the usual Django plumbing this module starts the background scan
worker automatically when the API boots, so a freshly started server can
process scans right away instead of waiting for somebody to open a second
terminal.

The worker is still a *separate process* — it is only launched, never run
inside the web request.  See ``scans.services.worker_launcher``.
"""
import logging
import os
import sys
import threading
import time

from django.apps import AppConfig

logger = logging.getLogger('scans.worker')

# Seconds to wait before the boot-time worker is started.  The delay lets the
# server finish its start-up (and the autoreloader settle) first.
BOOT_DELAY_SECONDS = 3.0

# Management commands that must never start a worker.
NON_SERVER_COMMANDS = {
    'collectstatic',
    'createsuperuser',
    'dumpdata',
    'loaddata',
    'makemigrations',
    'migrate',
    'runscanworker',
    'shell',
    'showmigrations',
    'sqlmigrate',
    'test',
}


class ScansConfig(AppConfig):
    name = 'scans'

    def ready(self):
        _schedule_boot_worker()


def _schedule_boot_worker():
    """
    Start a scan worker shortly after the API boots.

    The work is deferred to a background thread: ``AppConfig.ready()`` runs
    while the app registry is still being populated, so the database must not
    be touched from here.
    """
    argv = sys.argv[1:2]
    command = argv[0] if argv else ''

    # The worker command itself must never start another worker.
    if command == 'runscanworker':
        return
    if 'test' in sys.argv or 'pytest' in sys.modules:
        return
    if command in NON_SERVER_COMMANDS:
        return
    if os.environ.get('CODEGUARD_AUTOSTART_WORKER', '').strip().lower() in (
        '0', 'false', 'no', 'off',
    ):
        return

    thread = threading.Thread(
        target=_start_boot_worker,
        name='codeguard-boot-worker',
        daemon=True,
    )
    thread.start()


def _start_boot_worker():
    time.sleep(BOOT_DELAY_SECONDS)
    try:
        from scans.services.worker_launcher import ensure_worker_running

        ensure_worker_running(reason='api-startup')
    except Exception:  # noqa: BLE001 — a failed start must never break the server
        logger.exception('Could not auto-start the scan worker on API start-up')
