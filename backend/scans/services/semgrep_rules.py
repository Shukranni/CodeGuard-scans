"""
Local cache for the Semgrep rule set.

Running Semgrep with ``--config p/default`` makes it download the rule set
(~2.5 MB) from semgrep.dev and validate it against the registry on *every*
scan.  On a slow or restricted connection that download alone can eat the
whole scanner timeout, so the scan fails with a confusing "timed out" error
even though Semgrep itself works perfectly well.

This module downloads the rule set once into a cache directory and hands
Semgrep the cached file instead.  Scans then start immediately, produce the
same findings, and keep working when the network is unavailable.  The cache
is refreshed periodically so newly published rules are picked up.

The cache is written to a gitignored directory inside the backend folder (or to
the system temp directory when that folder is read only), and files are
written atomically, so a crashed download can never leave a truncated rule
file behind.
"""

import os
import tempfile
import time
import urllib.error
import urllib.request

# The registry configuration used for static analysis.
DEFAULT_CONFIG = 'p/default'

# The registry serves a configuration as plain YAML on this endpoint.
RULESET_URL_TEMPLATE = 'https://semgrep.dev/c/{config}'

# Rules change rarely — refreshing once a week is plenty.
RULES_TTL_SECONDS = int(os.environ.get('CODEGUARD_SEMGREP_RULES_TTL', str(7 * 24 * 3600)))

# Downloading the rule set can be slow, so it gets its own generous budget.
# It is deliberately *not* taken from the scanner timeout.
DOWNLOAD_TIMEOUT_SECONDS = int(os.environ.get('CODEGUARD_SEMGREP_RULES_TIMEOUT', '180'))

# A truncated download (or an error page served with a 200 status) must never
# be used as a rule set.
MIN_RULES_BYTES = 50_000

# Cached file names are derived from the configuration name.
_SAFE_NAME_CHARS = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-')

# The cache directory is resolved once per process — it is looked up on
# every scan and probing the filesystem each time is pointless.
_CACHE_DIR = None


def _slug(config):
    """Turn a configuration name into a safe file name."""
    cleaned = ''.join(c if c in _SAFE_NAME_CHARS else '_' for c in config)
    return cleaned or 'rules'


def _backend_dir():
    """Directory that holds the Django project (``backend/``)."""
    here = os.path.dirname(os.path.abspath(__file__))
    # backend/scans/services/semgrep_rules.py -> backend/
    return os.path.dirname(os.path.dirname(here))


def cache_dir():
    """
    Return the directory the rule sets are cached in.

    The preferred location is inside the backend folder so the cache is
    shared by every process on the machine.  When that folder is read only
    (some deployment setups) the system temp directory is used instead.
    """
    global _CACHE_DIR
    if _CACHE_DIR:
        return _CACHE_DIR

    override = os.environ.get('CODEGUARD_SEMGREP_RULES_DIR')
    candidates = [override] if override else []
    candidates.append(os.path.join(_backend_dir(), '.semgrep_cache'))
    candidates.append(os.path.join(tempfile.gettempdir(), 'codeguard-semgrep-cache'))

    resolved = tempfile.gettempdir()
    for path in candidates:
        if not path:
            continue
        try:
            os.makedirs(path, exist_ok=True)
            # Verify the directory is actually writable.
            probe = os.path.join(path, '.write-probe')
            with open(probe, 'w', encoding='utf-8') as handle:
                handle.write('ok')
            os.remove(probe)
            resolved = path
            break
        except OSError:
            continue

    _CACHE_DIR = resolved
    return resolved


def reset_cache_dir():
    """Forget the resolved cache directory (used by tests)."""
    global _CACHE_DIR
    _CACHE_DIR = None


def cached_rules_path(config=DEFAULT_CONFIG):
    """Return the path the rule set for ``config`` is cached at."""
    return os.path.join(cache_dir(), f'{_slug(config)}.yaml')


def rules_age_seconds(path):
    """Return how many seconds ago ``path`` was written (None if missing)."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    return max(0.0, time.time() - mtime)


def download_rules(config=DEFAULT_CONFIG, timeout=None):
    """
    Download a rule set and store it in the cache.

    Returns the path of the cached file, or ``None`` when the download
    failed.  The file is written to a temporary name first and moved into
    place atomically, so an interrupted download never corrupts the cache.
    """
    timeout = timeout or DOWNLOAD_TIMEOUT_SECONDS
    url = RULESET_URL_TEMPLATE.format(config=config)
    target = cached_rules_path(config)
    directory = os.path.dirname(target)

    tmp_path = None
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'CodeGuard'})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()

        if len(payload) < MIN_RULES_BYTES:
            return None

        os.makedirs(directory, exist_ok=True)
        handle, tmp_path = tempfile.mkstemp(prefix='.rules-', suffix='.tmp', dir=directory)
        with os.fdopen(handle, 'wb') as tmp_file:
            tmp_file.write(payload)
        os.replace(tmp_path, target)
        tmp_path = None
        return target
    except (urllib.error.URLError, OSError, ValueError):
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def ensure_local_rules(config=DEFAULT_CONFIG, force_refresh=False):
    """
    Return the path of a local rule file for ``config``.

    The cached file is reused while it is fresh enough; otherwise a refresh
    is attempted.  If the refresh fails but a stale copy exists, the stale
    copy is used — stale rules are far better than no rules at all.

    Returns ``None`` when no local rule file could be provided; the caller
    then falls back to the registry configuration.
    """
    path = cached_rules_path(config)
    age = rules_age_seconds(path)

    if age is not None and not force_refresh and age < RULES_TTL_SECONDS:
        return path

    refreshed = download_rules(config)
    if refreshed:
        return refreshed

    # Refresh failed — fall back to a stale cache if we have one.
    return path if age is not None else None


def prewarm_rules(config=DEFAULT_CONFIG):
    """
    Make sure the rule set is available on disk.

    Called by the worker on start-up so the first scan does not have to
    wait for the download.  Never raises.
    """
    try:
        return ensure_local_rules(config)
    except Exception:
        return None


def clear_rules_cache():
    """Remove every cached rule set (used by tests and maintenance commands)."""
    directory = cache_dir()
    try:
        for name in os.listdir(directory):
            if name.endswith('.yaml'):
                try:
                    os.remove(os.path.join(directory, name))
                except OSError:
                    pass
    except OSError:
        pass


def cache_size_bytes():
    """Return the total size of the cached rule sets (for diagnostics)."""
    total = 0
    try:
        for name in os.listdir(cache_dir()):
            path = os.path.join(cache_dir(), name)
            if os.path.isfile(path):
                total += os.path.getsize(path)
    except OSError:
        pass
    return total


__all__ = [
    'DEFAULT_CONFIG',
    'RULES_TTL_SECONDS',
    'DOWNLOAD_TIMEOUT_SECONDS',
    'cache_dir',
    'cache_size_bytes',
    'cached_rules_path',
    'clear_rules_cache',
    'download_rules',
    'ensure_local_rules',
    'prewarm_rules',
    'reset_cache_dir',
    'rules_age_seconds',
]
