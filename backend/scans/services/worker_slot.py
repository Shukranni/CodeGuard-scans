"""
Cross-process single-instance guard for the background scan worker.

Why this exists
---------------
The scan worker is a separate OS process.  Two workers running at the same
time would compete for the queue and — worse — the *startup recovery* of the
second worker would requeue the job the first worker is currently running,
so the same scan could end up being executed twice.

The guard is an **advisory file lock** that the worker holds for its whole
lifetime:

  * the operating system owns the lock, so it is released automatically when
    the worker dies (crash, ``kill``, reboot).  A stale lock file can never
    block a restart — the exact failure mode the database heartbeat has;
  * it behaves identically on Windows (``msvcrt.locking``) and POSIX
    (``fcntl.flock``).

The database heartbeat (``WorkerHeartbeat``) answers a different question:
"is a worker *anywhere* alive?" — that is what the API reports as
``worker_online``.  The file lock answers "is a worker alive *on this
machine*?", which is what the launcher needs before spawning a new one.

Usage::

    slot = WorkerSlot()
    if not slot.acquire(timeout=5):
        print('another worker is already running')
    else:
        try:
            ...  # do the work
        finally:
            slot.release()
"""
import os
import time
from pathlib import Path
import tempfile

IS_WINDOWS = os.name == 'nt'

LOCK_FILENAME = 'codeguard-scan-worker.lock'

# How long a starting worker waits for the slot before giving up.  The wait
# covers the tiny window in which the API probes the lock (the probe has to
# take the lock to find out whether it is free, so it briefly owns it).
DEFAULT_ACQUIRE_TIMEOUT_SECONDS = 5.0


def lock_path():
    """Absolute path of the lock file (per-user temporary directory)."""
    return Path(tempfile.gettempdir()) / LOCK_FILENAME


def _ensure_lock_file():
    """
    Create the lock file with at least one byte, without ever truncating or
    rewriting an existing file (another process may hold a lock on it).
    """
    path = Path(lock_path())
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return path
    except OSError:
        return path
    try:
        os.write(fd, b'\0')
    finally:
        os.close(fd)
    return path


def _try_lock(handle):
    """Try to take the exclusive lock without blocking.  True on success."""
    try:
        if IS_WINDOWS:
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        # The region is locked by somebody else (or the file vanished).
        return False


def _unlock(handle):
    """Release a lock previously taken by :func:`_try_lock`."""
    try:
        if IS_WINDOWS:
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass


class WorkerSlot:
    """
    Exclusive, process-scoped claim on the scan-worker slot.

    The slot is held until :meth:`release` is called — or until the process
    exits, whichever happens first.
    """

    def __init__(self):
        self._handle = None

    def _open(self):
        if self._handle is None:
            _ensure_lock_file()
            try:
                self._handle = open(str(lock_path()), 'a+b')
            except OSError:
                self._handle = None
        return self._handle

    def acquire(self, timeout=DEFAULT_ACQUIRE_TIMEOUT_SECONDS):
        """
        Try to claim the slot.

        Returns ``True`` when the slot is ours.  ``False`` means another
        worker process holds it.  The call retries for ``timeout`` seconds so
        a concurrent probe by the API cannot steal the slot from a worker
        that is in the middle of starting up.
        """
        deadline = time.monotonic() + max(float(timeout or 0), 0.0)
        while True:
            handle = self._open()
            if handle is not None and _try_lock(handle):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.2)

    def release(self):
        """Give the slot back.  Safe to call more than once."""
        handle = self._handle
        self._handle = None
        if handle is None:
            return
        _unlock(handle)
        try:
            handle.close()
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.release()
        return False


def probe_slot():
    """
    Check whether the slot is free.

    Returns ``True`` when no worker process is running on this machine and
    ``False`` when one is holding the slot.

    The probe briefly owns the lock itself; it releases it again right away.
    A worker that is starting up at the same moment may have to wait a few
    hundred milliseconds for the slot (see :meth:`WorkerSlot.acquire`).
    """
    slot = WorkerSlot()
    try:
        return slot.acquire(timeout=0)
    finally:
        slot.release()
