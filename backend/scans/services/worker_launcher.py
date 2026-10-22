"""
On-demand launch of the background scan worker.

The scan worker is a separate process (``python manage.py runscanworker``).
Historically it had to be started by hand, which meant a queued scan could
sit in ``queued`` forever while the UI reported *"No scan worker is
online"*.

This module lets the API start it automatically:

  * :func:`ensure_worker_running` is called when a scan is queued
    (``POST /api/scans/start/``) and when the status endpoint is polled, so a
    scan never waits for a human to start a second terminal;
  * it does nothing when a worker is already alive — that is checked with the
    operating-system file lock (:mod:`scans.services.worker_slot`, exact) and
    the database heartbeat (:class:`scans.models.WorkerHeartbeat`, works
    across hosts);
  * it spawns a **detached** ``manage.py runscanworker`` process, so the
    worker keeps running after the HTTP request that triggered it (and after
    the web server itself is restarted).

Configuration (environment variables):

``CODEGUARD_AUTOSTART_WORKER``
    ``1``/``true`` always on, ``0``/``false`` always off.  Unset (default):
    on while ``DEBUG`` is enabled (development) and off for production
    deployments that already run a dedicated worker through
    ``scripts/start_with_worker.sh``.

``CODEGUARD_WORKER_IDLE_TIMEOUT``
    Seconds an auto-started worker stays alive without processing a scan
    before it shuts itself down.  Default: 600 (10 minutes).  ``0`` keeps
    the worker alive forever.  A worker that was started by hand is not
    affected by this value.

``CODEGUARD_WORKER_LOG``
    Path of the worker log file.  Default: ``<backend>/logs/scanworker.log``.
"""
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .scan_worker import HEARTBEAT_TIMEOUT_SECONDS, worker_host
from .worker_slot import probe_slot

logger = logging.getLogger('scans.worker')

AUTOSTART_ENV = 'CODEGUARD_AUTOSTART_WORKER'
IDLE_TIMEOUT_ENV = 'CODEGUARD_WORKER_IDLE_TIMEOUT'
WORKER_LOG_ENV = 'CODEGUARD_WORKER_LOG'

WORKER_HEARTBEAT_NAME = 'scan-worker'

DEFAULT_IDLE_TIMEOUT_SECONDS = 600
DEFAULT_LOG_RELPATH = ('logs', 'scanworker.log')

# Minimum number of seconds between two spawn attempts inside one process.
# Several requests may ask for a worker at the same time; only the first one
# actually spawns a process.
SPAWN_COOLDOWN_SECONDS = 10.0

_TRUTHY = ('1', 'true', 'yes', 'on')
_FALSY = ('0', 'false', 'no', 'off')

_spawn_lock = threading.Lock()
_last_spawn_at = 0.0


def _env_flag(name, default=None):
    raw = os.environ.get(name, '').strip().lower()
    if raw in _TRUTHY:
        return True
    if raw in _FALSY:
        return False
    return default


def autostart_enabled():
    """
    Whether the API may start a scan worker on its own.

    Defaults to "on in development, off in production" — a production
    deployment normally runs the worker as its own supervised process.
    """
    override = _env_flag(AUTOSTART_ENV)
    if override is not None:
        return override
    return bool(getattr(settings, 'DEBUG', False))


def worker_idle_timeout():
    """Seconds an auto-started worker may stay idle before it exits."""
    raw = os.environ.get(IDLE_TIMEOUT_ENV, '').strip()
    if not raw:
        return DEFAULT_IDLE_TIMEOUT_SECONDS
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_IDLE_TIMEOUT_SECONDS
    return max(value, 0)


def worker_log_path():
    """Path of the file the auto-started worker writes its output to."""
    configured = os.environ.get(WORKER_LOG_ENV, '').strip()
    if configured:
        return Path(configured)
    return Path(settings.BASE_DIR).joinpath(*DEFAULT_LOG_RELPATH)


def _spawn_worker(reason=''):
    """Start a detached ``manage.py runscanworker`` process."""
    manage_py = Path(settings.BASE_DIR) / 'manage.py'
    if not manage_py.exists():
        logger.warning('Cannot auto-start the scan worker: %s is missing', manage_py)
        return False

    cmd = [
        sys.executable,
        '-u',  # unbuffered — the log file is the only place to look for output
        str(manage_py),
        'runscanworker',
        '--idle-timeout',
        str(int(worker_idle_timeout())),
    ]

    log_path = worker_log_path()
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = open(str(log_path), 'ab')
    except OSError:
        logger.warning('Cannot open the worker log %s; starting without a log file', log_path)
        log_handle = subprocess.DEVNULL

    popen_kwargs = {
        'cwd': str(settings.BASE_DIR),
        'stdin': subprocess.DEVNULL,
        'stdout': log_handle,
        'stderr': subprocess.STDOUT,
    }
    if os.name == 'nt':
        # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP — the worker must not
        # die with the console/web request that started it, and it must not
        # receive the console's Ctrl+C.
        popen_kwargs['creationflags'] = 0x00000008 | 0x00000200
        # close_fds=True keeps the worker from inheriting the web server's
        # listening socket (which would keep the port bound after a reload).
        popen_kwargs['close_fds'] = True
    else:
        popen_kwargs['start_new_session'] = True
        popen_kwargs['close_fds'] = True

    try:
        process = subprocess.Popen(cmd, **popen_kwargs)
    except Exception:  # noqa: BLE001 — a failed spawn must never break a request
        logger.exception('Failed to auto-start the scan worker')
        return False
    finally:
        if log_handle is not subprocess.DEVNULL:
            try:
                log_handle.close()
            except OSError:
                pass

    logger.info(
        'Auto-started scan worker pid=%s (reason=%s, log=%s)',
        process.pid, reason or 'unspecified', log_path,
    )
    return True


def remote_worker_is_live():
    """
    True when a worker on **another** host is alive.

    A heartbeat that belongs to *this* machine is deliberately ignored: the
    operating-system lock already answered that question exactly.  A worker
    that was killed leaves its heartbeat row behind for up to the heartbeat
    timeout, and that stale row must not delay the restart of a local worker.
    """
    from scans.models import WorkerHeartbeat

    row = WorkerHeartbeat.objects.filter(name=WORKER_HEARTBEAT_NAME).first()
    if row is None:
        return False
    age = (timezone.now() - row.last_seen).total_seconds()
    if age > HEARTBEAT_TIMEOUT_SECONDS:
        return False
    host = worker_host(row.worker_id)
    return bool(host) and host != socket.gethostname()


def ensure_worker_running(reason=''):
    """
    Make sure a scan worker is available.

    Returns ``True`` when a worker is online (either it was already running
    or one was just started) and ``False`` when no worker could be started.

    This never raises: a failure to start the worker must not break the API
    request that triggered it.
    """
    try:
        if not autostart_enabled():
            return False

        # 1) A worker process on this machine?  The file lock is exact: it is
        #    released by the OS the moment the worker dies.
        if not probe_slot():
            return True

        # 2) A worker on another host?  Only the database heartbeat can tell.
        if remote_worker_is_live():
            return True

        # 3) Nobody is working: start one.
        global _last_spawn_at
        with _spawn_lock:
            now = time.monotonic()
            if now - _last_spawn_at < SPAWN_COOLDOWN_SECONDS:
                return False
            _last_spawn_at = now
            return _spawn_worker(reason)
    except Exception:  # noqa: BLE001 — never break the caller
        logger.exception('Could not ensure a scan worker is running')
        return False
