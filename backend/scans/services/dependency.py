import subprocess
import json
import os
import logging
import shutil

DEPENDENCY_TIMEOUT = 120
logger = logging.getLogger(__name__)

# Cached executable lookup so availability is not re-resolved for every scan.
_NPM_EXE_CACHE = None


def _find_npm():
    global _NPM_EXE_CACHE
    if _NPM_EXE_CACHE is None:
        _NPM_EXE_CACHE = shutil.which('npm') or False
    return _NPM_EXE_CACHE or None


def reset_npm_cache():
    global _NPM_EXE_CACHE
    _NPM_EXE_CACHE = None


def npm_available():
    return _find_npm() is not None


class DependencyScanner:
    def __init__(self, project_path):
        self.project_path = project_path

    @staticmethod
    def _lockfile_lines(scan_dir, vulnerabilities):
        """Resolve npm package node paths to lines in package-lock.json."""
        nodes = {
            node
            for vuln in vulnerabilities.values()
            if isinstance(vuln, dict)
            for node in vuln.get('nodes', [])
            if isinstance(node, str)
        }
        pending = {json.dumps(node, ensure_ascii=False): node for node in nodes}
        lines = {}
        if not pending:
            return lines
        lockfile_path = os.path.join(scan_dir, 'package-lock.json')
        try:
            with open(lockfile_path, 'r', encoding='utf-8') as lockfile:
                for line_number, line in enumerate(lockfile, start=1):
                    for serialized_node, node in list(pending.items()):
                        if serialized_node + ':' in line:
                            lines[node] = line_number
                            del pending[serialized_node]
                    if not pending:
                        break
        except OSError:
            logger.warning('Could not read package-lock.json to locate dependency findings.')
        return lines

    def scan(self):
        try:
            npm_exe = _find_npm()
            if not npm_exe:
                return {
                    'error': 'npm executable not found. Install Node.js and ensure npm is on PATH.',
                    'unavailable': True,
                }

            # Recursively locate a lockfile-backed npm project.  ``npm audit``
            # requires a lockfile; a directory with only ``package.json`` would
            # fail with "requires an existing lockfile".  So we search for a
            # package-lock.json specifically, and only fall back to
            # package.json to report a meaningful "skipped" reason.
            scan_dir = None
            json_only_dir = None
            for root, dirs, files in os.walk(self.project_path):
                # Ignore common big directories in search
                for d in list(dirs):
                    if d.lower() in {'node_modules', '.git', '.venv', 'venv', 'env'}:
                        dirs.remove(d)
                if 'package-lock.json' in files:
                    scan_dir = root
                    break
                if 'package.json' in files and json_only_dir is None:
                    json_only_dir = root

            if scan_dir is None:
                # No lockfile to audit.  This is not a scanner failure — the
                # audit simply cannot run.  Reported as "skipped" so the scan
                # is not wrongly downgraded to completed_with_warnings.
                if json_only_dir is not None:
                    reason = ('Found package.json but no package-lock.json. '
                              'npm audit requires a lockfile; skipping dependency audit.')
                else:
                    reason = 'No package.json or package-lock.json found. Skipping dependency audit.'
                return {'skipped': True, 'reason': reason}

            # On Windows, npm is a .cmd script, so the command must go through
            # the shell (cmd.exe).  On POSIX, shell=True with a LIST would be
            # wrong: sh -c receives only argv[0] ("npm" — no subcommand!) and
            # the remaining items become $0/$1, which silently ran a bare `npm`
            # whose help text is not JSON ("Failed to parse npm audit output").
            # Run the absolute path directly there.
            if os.name == 'nt':
                run_args = '"{}" audit --json'.format(npm_exe)
                use_shell = True
            else:
                run_args = [npm_exe, 'audit', '--json']
                use_shell = False
            result = subprocess.run(
                run_args,
                cwd=scan_dir,
                capture_output=True,
                shell=use_shell,
                timeout=DEPENDENCY_TIMEOUT
            )
            stdout_str = result.stdout.decode('utf-8', errors='replace')
            stderr_str = result.stderr.decode('utf-8', errors='replace')

            # npm audit returns non-zero exit code when vulnerabilities exist.
            # We still want to parse the JSON if possible.
            try:
                data = json.loads(stdout_str)
            except json.JSONDecodeError:
                lowered = stderr_str.lower()
                if 'is not recognized' in lowered or 'command not found' in lowered:
                    return {
                        'error': 'npm executable not found. Install Node.js and ensure npm is on PATH.',
                        'unavailable': True,
                    }
                return {
                    'error': 'Failed to parse npm audit output',
                    'exit_code': result.returncode,
                    'raw_output': stderr_str[:500]
                }

            # npm can emit a JSON error object.  A missing/invalid lockfile is
            # not a scanner failure — audit simply does not apply — so it is
            # reported as "skipped", not "error".
            if isinstance(data, dict) and data.get('error'):
                err = data['error']
                summary = (err.get('summary') if isinstance(err, dict) else None) or 'unknown error'
                if 'lockfile' in str(summary).lower():
                    return {
                        'skipped': True,
                        'reason': f'npm audit cannot run: {summary}',
                    }
                return {
                    'error': f'npm audit failed: {summary}',
                    'exit_code': result.returncode,
                }

            # Extract vulnerabilities
            vulnerabilities = data.get('vulnerabilities', {})
            if isinstance(vulnerabilities, dict):
                node_lines = self._lockfile_lines(scan_dir, vulnerabilities)
                for vuln in vulnerabilities.values():
                    if isinstance(vuln, dict):
                        vuln['line'] = min(
                            (node_lines[node] for node in vuln.get('nodes', []) if node in node_lines),
                            default=None,
                        )
            
            # Count by severity
            severity_counts = {
                'low': 0,
                'moderate': 0,
                'high': 0,
                'critical': 0
            }
            
            for vuln in vulnerabilities.values():
                vuln_severity = vuln.get('severity', 'low') if isinstance(vuln, dict) else 'low'
                if vuln_severity in severity_counts:
                    severity_counts[vuln_severity] += 1
            
            return {
                'total_vulnerabilities': len(vulnerabilities),
                'severity_counts': severity_counts,
                'all_vulnerabilities': vulnerabilities,
                'summary': data.get('metadata', {}).get('summary', 'No summary available'),
                'exit_code': result.returncode,
            }

        except FileNotFoundError:
            return {
                'error': 'npm not found. Please install Node.js and npm (ensure npm.cmd is on PATH).',
                'unavailable': True,
            }
        except subprocess.TimeoutExpired:
            return {
                'error': f'Dependency scan timed out after {DEPENDENCY_TIMEOUT} seconds.'
            }
        except Exception as e:
            return {
                'error': str(e)
            }
