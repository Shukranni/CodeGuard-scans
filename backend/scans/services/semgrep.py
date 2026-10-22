import logging
import subprocess
import json
import shutil
import os
import sys
import time

from . import github_actions
from .semgrep_rules import DEFAULT_CONFIG, ensure_local_rules

logger = logging.getLogger('scans.worker')

# Directories to skip — these are never user source code
EXCLUDED_DIRS = [
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.venv', 'venv', 'env', '.tox', 'coverage', '.next',
    'vendor', 'bower_components', 'target', '.cache',
]

# The scanner used to give up after 120 seconds, which was far too short:
# matching the full rule set against a medium sized project regularly needs
# well over a minute of CPU time.  The timeout is configurable so slower
# machines can be tuned without a code change.
SEMGREP_TIMEOUT = int(os.environ.get('CODEGUARD_SEMGREP_TIMEOUT', '300'))

# Analysing a project takes roughly a second per file, so the timeout grows
# with the size of the project instead of failing every larger upload.  It is
# a limit, not a delay: the scan still finishes as soon as Semgrep is done.
SEMGREP_SECONDS_PER_FILE = float(os.environ.get('CODEGUARD_SEMGREP_SECONDS_PER_FILE', '1.5'))

# Upper bound for the scaled timeout.
SEMGREP_MAX_TIMEOUT = int(os.environ.get('CODEGUARD_SEMGREP_MAX_TIMEOUT', '900'))

# Extra time granted to a GitHub Actions run on top of the local timeout
# budget: runner boot, `pip install semgrep` and the archive download all
# happen before Semgrep itself starts.  The workflow's own job timeout
# (25 minutes) always stays above timeout_for() + this slack.
REMOTE_SETUP_SLACK_SECONDS = int(os.environ.get('CODEGUARD_SEMGREP_REMOTE_SLACK', '300'))

# Files larger than this are not worth analysing (and slow down the scan).
MAX_TARGET_BYTES = 1000000

# A run that dies abnormally after less than this long is worth retrying once
# — transient failures (a killed worker process, a hiccup on the network)
# should not cost the user a whole scan.
RETRYABLE_RUNTIME_SECONDS = 60

# Exit code Windows reports when a process is killed with a control event.
_WINDOWS_CONTROL_C_EXIT = 3221225786

# Executable lookup is expensive (it walks several directories), so the
# result is cached for the lifetime of the process.  Call
# ``reset_semgrep_cache()`` to force a re-check (used by tests/deploy hooks).
_SEMGREP_EXE_CACHE = None


def _find_semgrep_uncached():
    """Find the pysemgrep/semgrep executable across common Windows install locations."""
    # Explicit override for deployments that install semgrep somewhere custom.
    override = os.environ.get('CODEGUARD_SEMGREP_BIN')
    if override and os.path.isfile(override):
        return override

    candidate_dirs = []

    # Current interpreter's Scripts dir
    candidate_dirs.append(os.path.join(sys.prefix, 'Scripts'))

    # User-level Scripts dirs (e.g., AppData\Roaming\Python\Python3xx\Scripts)
    import site
    user_base = site.USER_BASE
    candidate_dirs.append(os.path.join(user_base, 'Scripts'))
    # site.USER_BASE may omit the version segment; check its children too.
    if os.path.isdir(user_base):
        for entry in os.listdir(user_base):
            versioned = os.path.join(user_base, entry, 'Scripts')
            if os.path.isdir(versioned):
                candidate_dirs.append(versioned)

    # Versioned Python dirs under AppData\Roaming\Python\
    roaming_python = os.path.join(os.environ.get('APPDATA', ''), 'Python')
    if os.path.isdir(roaming_python):
        for entry in os.listdir(roaming_python):
            candidate_dirs.append(os.path.join(roaming_python, entry, 'Scripts'))

    # pysemgrep.exe is the real entry point on Windows (semgrep.exe is just a shim)
    for d in candidate_dirs:
        for exe_name in ('pysemgrep.exe', 'pysemgrep', 'semgrep.exe', 'semgrep'):
            candidate = os.path.join(d, exe_name)
            if os.path.isfile(candidate):
                return candidate

    # Fallback: system PATH
    return shutil.which('pysemgrep') or shutil.which('semgrep')


def _find_semgrep():
    """Cached wrapper around :func:`_find_semgrep_uncached`."""
    global _SEMGREP_EXE_CACHE
    if _SEMGREP_EXE_CACHE is None:
        _SEMGREP_EXE_CACHE = _find_semgrep_uncached() or False
    return _SEMGREP_EXE_CACHE or None


def reset_semgrep_cache():
    """Force the executable lookup to run again on the next call."""
    global _SEMGREP_EXE_CACHE
    _SEMGREP_EXE_CACHE = None


def semgrep_available():
    # A configured GitHub Actions runner counts as availability even when
    # this machine has no local semgrep install at all — unless the rule
    # config only exists on this machine.
    if github_actions.enabled() and _remote_config() is not None:
        return True
    return _find_semgrep() is not None


def github_actions_enabled():
    """True when Semgrep is configured to run remotely on GitHub Actions."""
    return github_actions.enabled()


def available_memory_gb():
    """
    Return the free physical memory in GB, or ``None`` when it cannot be read.

    Used to decide how many Semgrep workers may run in parallel: every
    worker needs its own share of the rule set in memory, so on a machine
    that is short on RAM extra workers make the scan slower, not faster.
    """
    try:
        if os.name == 'nt':
            import ctypes

            class _MemoryStatusEx(ctypes.Structure):
                _fields_ = [
                    ('dwLength', ctypes.c_ulong),
                    ('dwMemoryLoad', ctypes.c_ulong),
                    ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong),
                    ('ullTotalPageFile', ctypes.c_ulonglong),
                    ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong),
                    ('ullAvailVirtual', ctypes.c_ulonglong),
                    ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
                ]

            status = _MemoryStatusEx()
            status.dwLength = ctypes.sizeof(_MemoryStatusEx)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.ullAvailPhys / (1024 ** 3)
        else:
            with open('/proc/meminfo', encoding='utf-8') as handle:
                for line in handle:
                    if line.startswith('MemAvailable:'):
                        return int(line.split()[1]) / (1024 ** 2)
    except Exception:
        pass
    return None


def default_jobs():
    """
    Number of Semgrep worker processes to use.

    ``CODEGUARD_SEMGREP_JOBS`` overrides the value.  Otherwise the count is
    derived from the machine: one worker when memory is tight, two when
    there is room.  Semgrep's matching phase is CPU bound, but each worker
    holds its own copy of the rule set, so over-parallelising a scan on a
    memory constrained machine is the fastest way to make it time out.
    """
    override = os.environ.get('CODEGUARD_SEMGREP_JOBS')
    if override:
        try:
            return max(1, int(override))
        except ValueError:
            pass

    cores = os.cpu_count() or 1
    free_gb = available_memory_gb()
    if free_gb is not None and free_gb < 2.0:
        return 1
    return max(1, min(2, cores))


def max_memory_mib():
    """
    Value for Semgrep's ``--max-memory`` flag (MiB; 0 disables the limit).

    With a limit set, Semgrep skips the offending file/rule instead of growing
    until the kernel's OOM killer terminates the process — the difference
    between "one file skipped" and "the whole scan failed" on a memory-capped
    host such as a 512 MB free hosting instance.  The default is 0 (no limit)
    so local development behaviour is unchanged; small hosts opt in with
    ``CODEGUARD_SEMGREP_MAX_MEMORY``.
    """
    override = os.environ.get('CODEGUARD_SEMGREP_MAX_MEMORY')
    if override is None:
        return 0
    try:
        return max(0, int(override))
    except ValueError:
        return 0


def rules_config():
    """
    Return the value for Semgrep's ``--config`` option.

    A locally cached rule set is preferred: it removes the per-scan download
    from semgrep.dev (which regularly took longer than the whole scan) and
    keeps the scan working when the network is unavailable.  When no local
    copy can be provided the registry configuration is used instead.
    """
    name = (os.environ.get('CODEGUARD_SEMGREP_CONFIG') or DEFAULT_CONFIG).strip() or DEFAULT_CONFIG

    # A path or URL is passed through untouched.
    if name.startswith(('http://', 'https://', '/', '.')) or os.path.isfile(name):
        return name

    local = ensure_local_rules(name)
    return local or name


def timeout_for(project_path):
    """
    Return the timeout (in seconds) to use for a project.

    Semgrep needs roughly a second per analysed file, so a fixed timeout
    fails every project above a certain size.  The limit therefore grows
    with the number of files and is capped so a runaway scan still ends.
    """
    try:
        file_count = 0
        for _root, _dirs, files in os.walk(project_path):
            file_count += len(files)
    except OSError:
        file_count = 0

    scaled = SEMGREP_TIMEOUT + int(file_count * SEMGREP_SECONDS_PER_FILE)
    return max(SEMGREP_TIMEOUT, min(SEMGREP_MAX_TIMEOUT, scaled))


def _command_args(config, jobs, max_memory):
    """Every Semgrep flag except the executable, ``scan`` and the target."""
    exclude_flags = []
    for directory in EXCLUDED_DIRS:
        exclude_flags += ['--exclude', directory]

    return [
        '--json',
        '--config', config,
        '--jobs', str(jobs),
        '--max-target-bytes', str(MAX_TARGET_BYTES),
        '--max-memory', str(max_memory),
        # Do not phone home: the version check and the metrics upload each
        # cost a network round trip that can stall a scan.
        '--disable-version-check',
        '--metrics', 'off',
    ] + exclude_flags


def _build_command(semgrep_exe, config):
    """Build the Semgrep command line (executed inside ``project_path``)."""
    return (
        [semgrep_exe, 'scan']
        + _command_args(config, default_jobs(), max_memory_mib())
        + ['.']
    )


def _diagnose_failure(returncode, stderr_str, elapsed):
    """
    Turn a failed Semgrep run into a message a user can act on.

    Semgrep writes its progress table to stderr, so the *end* of stderr
    holds the interesting part — the beginning is just noise.
    """
    stderr = stderr_str or ''

    if 'UnicodeEncodeError' in stderr or "'charmap' codec can't encode" in stderr:
        return ('Semgrep crashed with a text encoding error while writing its output. '
                'This is a bug in the installed Semgrep/Python combination; make sure '
                'the worker runs with PYTHONUTF8=1.')

    if returncode == _WINDOWS_CONTROL_C_EXIT:
        return ('Semgrep was terminated unexpectedly (exit code 3221225786). '
                'This usually means the process was killed — most often because the '
                'machine ran out of memory. Try scanning a smaller project or '
                'reduce CODEGUARD_SEMGREP_JOBS.')

    if returncode in (-9, 137):
        return ('Semgrep was killed (exit code %s). This usually means the machine ran '
                'out of memory.' % returncode)

    if returncode == 1:
        return ('Semgrep exited with an error after %.0fs. See the scanner output for '
                'details.' % elapsed)

    return ('Semgrep exited with code %s after %.0fs without producing usable output.'
            % (returncode, elapsed))


def _stderr_tail(stderr_str, limit=1500):
    """Return the last part of stderr, where Semgrep reports its errors."""
    stderr = (stderr_str or '').strip()
    if len(stderr) <= limit:
        return stderr
    return '...\n' + stderr[-limit:]


def _summarize(data, exit_code):
    """Turn parsed Semgrep JSON into the result dict the pipeline stores."""
    results = data.get('results', [])

    severity_counts = {'INFO': 0, 'WARNING': 0, 'ERROR': 0}
    for finding in results:
        severity = finding.get('extra', {}).get('severity', 'INFO')
        if severity in severity_counts:
            severity_counts[severity] += 1

    return {
        'total_vulnerabilities': len(results),
        'severity_counts': severity_counts,
        'all_vulnerabilities': results,
        'exit_code': exit_code,
    }


def _remote_config():
    """
    The ``--config`` value for a remote run.

    A local path or cached rule file only exists on this machine, so a
    remote run needs something the GitHub runner can fetch itself — the
    registry config (``p/default``) or an https URL.  Anything else
    returns ``None`` and the scan stays local.
    """
    name = (os.environ.get('CODEGUARD_SEMGREP_CONFIG') or DEFAULT_CONFIG).strip() or DEFAULT_CONFIG
    if name.startswith(('http://', 'https://')):
        return name
    if name.startswith(('/', '.')) or os.path.isfile(name):
        return None
    return name


def _remote_jobs():
    """Worker count for the GitHub runner (2 cores, 7 GB — no tight cap)."""
    try:
        return max(1, int(os.environ.get('CODEGUARD_SEMGREP_REMOTE_JOBS', '2')))
    except (TypeError, ValueError):
        return 2


# Characters that would not survive a workflow input + shell word split.
_UNSAFE_ARG_CHARS = set(' \t\r\n"\'$`;&|<>(){}[]*?!~#\\')


def _args_are_safe(args):
    """
    True when every argument can travel through a workflow input and a
    shell word-split unchanged.  Anything unusual keeps the scan local
    rather than risking a mangled command line on the runner.
    """
    return all(arg and not (set(arg) & _UNSAFE_ARG_CHARS) for arg in args)


class SemgrepScanner:
    def __init__(self, project_path, project=None):
        self.project_path = project_path
        # The Project row (when known) lets the scanner mint a signed
        # archive link for the GitHub Actions runner.
        self.project = project

    def _scan_with_github_actions(self):
        """
        Dispatch this scan to GitHub Actions and return its result dict.

        Raises :class:`scans.services.github_actions.GitHubActionsError`
        on any transport or protocol problem — ``scan()`` falls back to the
        local install when that happens.
        """
        from .archive_link import build_archive_url

        config = _remote_config()
        if config is None:
            return {
                'error': 'CODEGUARD_SEMGREP_CONFIG points at a local file; remote '
                         'scanning needs a registry config such as p/default.',
            }

        archive_url = build_archive_url(self.project)
        if not archive_url:
            return {
                'error': 'CODEGUARD_PUBLIC_API_BASE is not set; the GitHub Actions '
                         'runner does not know where to fetch the archive from.',
            }

        # 5000 MiB is Semgrep's own default — the runner has 7 GB, so
        # unlike the local 192 MiB cap nothing needs squeezing here.
        args = _command_args(config, _remote_jobs(), 5000)
        if not _args_are_safe(args):
            return {'error': 'Remote Semgrep arguments contain unsupported characters.'}

        scan_id = f'{self.project.pk}-{int(time.time())}'
        timeout = timeout_for(self.project_path) + REMOTE_SETUP_SLACK_SECONDS
        github_actions.dispatch(scan_id=scan_id, archive_url=archive_url, args=' '.join(args))
        payload = github_actions.wait_for_result(scan_id, timeout_seconds=timeout)

        try:
            data = json.loads(payload.get('stdout') or '')
        except json.JSONDecodeError:
            return {
                'error': 'GitHub Actions returned unusable Semgrep output: '
                         + _stderr_tail(payload.get('stderr'), 600),
                'exit_code': payload.get('exit_code'),
                'run_url': payload.get('run_url'),
            }
        return _summarize(data, payload.get('exit_code'))

    def scan(self):
        # Remote first: when GitHub Actions is configured, that is the
        # point (its runners have the memory this machine lacks).  Every
        # remote problem falls through to a local install if one exists,
        # so enabling the feature can never make a scan worse.
        remote_failure = None
        if self.project is not None and github_actions.enabled():
            try:
                remote_result = self._scan_with_github_actions()
            except github_actions.GitHubActionsError as exc:
                remote_result = {'error': str(exc)}
            except Exception as exc:  # noqa: BLE001 — remote must never crash a scan
                remote_result = {'error': f'GitHub Actions scan failed: {exc}'}

            if not remote_result.get('error'):
                return remote_result
            remote_failure = remote_result
            logger.warning(
                'Remote Semgrep run failed (%s) — trying the local install',
                remote_result.get('error'),
            )

        semgrep_exe = _find_semgrep()
        if not semgrep_exe:
            if remote_failure:
                # Remote was configured but broke and there is no local
                # fallback: report the remote error (a real failure — the
                # scanner was available, it just did not complete).
                return remote_failure
            return {
                'error': 'semgrep executable not found. Install it with "pip install semgrep" '
                         'or set the CODEGUARD_SEMGREP_BIN environment variable.',
                'unavailable': True,
            }

        try:
            env = os.environ.copy()
            # Force UTF-8 to prevent Windows charmap crashes on Unicode files
            env['PYTHONUTF8'] = '1'
            env['PYTHONIOENCODING'] = 'utf-8'

            cmd = _build_command(semgrep_exe, rules_config())
            timeout = timeout_for(self.project_path)

            result = None
            stdout_str = ''
            stderr_str = ''
            elapsed = 0.0
            data = None

            for attempt in range(2):
                started = time.monotonic()
                try:
                    result = subprocess.run(
                        cmd,
                        cwd=self.project_path,
                        capture_output=True,
                        env=env,
                        timeout=timeout,
                    )
                except subprocess.TimeoutExpired:
                    return {
                        'error': f'Semgrep scan timed out after {timeout}s. '
                                 'The project may be too large. Try excluding more directories.'
                    }
                except Exception as e:
                    return {'error': str(e)}

                elapsed = time.monotonic() - started
                stdout_str = result.stdout.decode('utf-8', errors='replace')
                stderr_str = result.stderr.decode('utf-8', errors='replace')

                try:
                    data = json.loads(stdout_str)
                    break
                except json.JSONDecodeError:
                    # A run that died early is often transient — give it one
                    # more chance before reporting a failure.
                    if attempt == 0 and elapsed < RETRYABLE_RUNTIME_SECONDS:
                        continue
                    return {
                        'error': _diagnose_failure(result.returncode, stderr_str, elapsed),
                        'exit_code': result.returncode,
                        'raw_output': _stderr_tail(stderr_str),
                    }

            return _summarize(data, result.returncode)

        except Exception as e:
            return {'error': str(e)}
