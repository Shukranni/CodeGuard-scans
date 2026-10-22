import os
import shutil
import time

from .dependency import DependencyScanner, npm_available, reset_npm_cache
from .semgrep import SemgrepScanner, semgrep_available, reset_semgrep_cache
from .gitleaks import GitleaksScanner, gitleaks_available, reset_gitleaks_cache

EXCLUDED_DIRS = {
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.venv', 'venv', 'env', '.next', 'vendor', 'bower_components', 'target'
}

# Scanner availability is stable for the lifetime of a process, so it is
# cached briefly instead of re-probing executables for every scan.
_AVAILABILITY_TTL_SECONDS = 60
_AVAILABILITY_CACHE = {'ts': 0.0, 'value': None}

SCANNER_LABELS = {
    'semgrep': 'Semgrep (static analysis)',
    'gitleaks': 'GitLeaks (secret detection)',
    'dependency': 'npm audit (dependency vulnerabilities)',
}

# The single source of truth for scanner names the backend can actually run.
# ``StartScanView`` rejects anything outside this set so a scan can never be
# queued that is guaranteed to fail.  Every key here must be handled by
# ``ScannerRunner.SCANNER_MAP``.
SUPPORTED_SCANNERS = ('semgrep', 'gitleaks', 'dependency')


def scanner_availability(force_refresh=False):
    """
    Return cached availability info for every integrated scanner::

        {'semgrep': {'available': True, 'label': ..., 'hint': ...}, ...}

    A missing tool never raises — it is reported explicitly so the API and
    the UI can show a clear diagnostic instead of hanging.
    """
    now = time.monotonic()
    if (
        not force_refresh
        and _AVAILABILITY_CACHE['value'] is not None
        and (now - _AVAILABILITY_CACHE['ts']) < _AVAILABILITY_TTL_SECONDS
    ):
        return _AVAILABILITY_CACHE['value']

    value = {
        'semgrep': {
            'available': semgrep_available(),
            'label': SCANNER_LABELS['semgrep'],
            'hint': 'pip install semgrep',
        },
        'gitleaks': {
            'available': gitleaks_available(),
            'label': SCANNER_LABELS['gitleaks'],
            'hint': 'https://github.com/gitleaks/gitleaks (must be on PATH)',
        },
        'dependency': {
            'available': npm_available(),
            'label': SCANNER_LABELS['dependency'],
            'hint': 'Install Node.js (npm must be on PATH)',
        },
    }
    _AVAILABILITY_CACHE['ts'] = now
    _AVAILABILITY_CACHE['value'] = value
    return value


def reset_scanner_caches():
    """Reset every cached scanner lookup (used by tests and after installing tools)."""
    reset_semgrep_cache()
    reset_gitleaks_cache()
    reset_npm_cache()
    _AVAILABILITY_CACHE['ts'] = 0.0
    _AVAILABILITY_CACHE['value'] = None


def classify_scan_result(result):
    """
    Classify one scanner's result dict as ``'ok'``, ``'skipped'`` or ``'error'``.
    Distinguishes "scanner found nothing / does not apply" from "scanner
    failed to execute".
    """
    if not isinstance(result, dict):
        return 'error'
    if result.get('skipped'):
        return 'skipped'
    if result.get('error'):
        return 'error'
    return 'ok'


class ScannerRunner:
    SCANNER_MAP = {
        'dependency': DependencyScanner,
        'semgrep': SemgrepScanner,
        'gitleaks': GitleaksScanner
    }

    def __init__(self, project_path, selected_scanners):
        # 1. Resolve nested single-directory wrappers (common in zip downloads)
        actual_path = project_path
        try:
            items = os.listdir(project_path)
            # Filter out hidden files
            visible_items = [item for item in items if not item.startswith('.') and item != '__MACOSX']
            if len(visible_items) == 1 and os.path.isdir(os.path.join(project_path, visible_items[0])):
                actual_path = os.path.join(project_path, visible_items[0])
        except Exception:
            pass
        self.project_path = actual_path
        self.selected_scanners = selected_scanners

        # 2. Proactively delete heavy/ignored directories to speed up scans and prevent hanging
        # ONLY do this if the path is in a temporary folder (to protect active development workspaces)
        import tempfile
        is_temp = False
        try:
            temp_dir = tempfile.gettempdir()
            norm_project = os.path.normpath(self.project_path).lower()
            norm_temp = os.path.normpath(temp_dir).lower()
            is_temp = norm_project.startswith(norm_temp) or 'appdata\\local\\temp' in norm_project
        except Exception:
            pass

        if is_temp:
            try:
                for root, dirs, files in os.walk(self.project_path, topdown=True):
                    for d in list(dirs):
                        if d.lower() in EXCLUDED_DIRS:
                            dir_path = os.path.join(root, d)
                            shutil.rmtree(dir_path, ignore_errors=True)
                            dirs.remove(d)
            except Exception:
                pass


    def run_all(self, on_progress=None):
        """
        Execute every selected scanner sequentially.

        ``on_progress(event, scanner_name, result, completed, total)`` is
        invoked with ``event`` = ``'started'`` or ``'finished'`` so callers
        can persist incremental status/progress while scanners run.

        One failing scanner never prevents the remaining scanners from
        running; failures are reported inside the returned results dict.
        """
        results = {}
        total = len(self.selected_scanners)
        completed = 0

        for scanner_name in self.selected_scanners:
            if scanner_name in self.SCANNER_MAP:
                if on_progress:
                    try:
                        on_progress('started', scanner_name, None, completed, total)
                    except Exception:
                        pass
                scanner_class = self.SCANNER_MAP[scanner_name]
                scanner_instance = scanner_class(self.project_path)
                try:
                    # Execute the scan
                    scan_result = scanner_instance.scan()
                    results[scanner_name] = scan_result
                except Exception as e:
                    results[scanner_name] = {'error': str(e)}
            else:
                results[scanner_name] = {'error': f'Scanner {scanner_name} not supported'}
            completed += 1
            if on_progress:
                try:
                    on_progress('finished', scanner_name, results[scanner_name], completed, total)
                except Exception:
                    pass

        return results
