import subprocess
import json
import os
import shutil
import tempfile

GITLEAKS_TIMEOUT = 120

# Cached executable lookup — resolving PATH once per process avoids
# repeating it for every scan.
_GITLEAKS_EXE_CACHE = None


def _find_gitleaks():
    global _GITLEAKS_EXE_CACHE
    if _GITLEAKS_EXE_CACHE is None:
        override = os.environ.get('CODEGUARD_GITLEAKS_BIN')
        if override and os.path.isfile(override):
            _GITLEAKS_EXE_CACHE = override
        else:
            _GITLEAKS_EXE_CACHE = shutil.which('gitleaks') or False
    return _GITLEAKS_EXE_CACHE or None


def reset_gitleaks_cache():
    global _GITLEAKS_EXE_CACHE
    _GITLEAKS_EXE_CACHE = None


def gitleaks_available():
    return _find_gitleaks() is not None


class GitleaksScanner:
    def __init__(self, project_path):
        self.project_path = project_path

    def scan(self):
        gitleaks_exe = _find_gitleaks()
        if not gitleaks_exe:
            return {
                'error': 'gitleaks executable not found. Install it and ensure it is on PATH '
                         '(https://github.com/gitleaks/gitleaks) or set CODEGUARD_GITLEAKS_BIN.',
                'unavailable': True,
            }

        report_path = None
        try:
            # Gitleaks requires a temporary file for the JSON report
            with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as tmp_file:
                report_path = tmp_file.name

            # Run gitleaks detect over the directory.
            # gitleaks 8.x has NO internal timeout by default (--timeout 0), so
            # a pathological tree could block a worker for a long time.  Pass an
            # explicit scan timeout (kept below our subprocess timeout) so the
            # tool always returns a report instead of hanging.
            result = subprocess.run(
                [gitleaks_exe, 'detect', '--source', self.project_path,
                 '--report-format', 'json', '--report-path', report_path, '--no-git',
                 '--timeout', str(max(1, GITLEAKS_TIMEOUT - 10))],
                capture_output=True,
                text=True,
                encoding='utf-8',
                timeout=GITLEAKS_TIMEOUT
            )

            stderr_tail = (result.stderr or '')[:500]

            results = []
            report_exists = os.path.exists(report_path)
            if report_exists:
                # Read JSON report
                with open(report_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        results = json.loads(content)
                os.remove(report_path)
                report_path = None
            elif result.returncode not in (0, 1):
                # No report AND an unexpected exit code means gitleaks itself
                # failed — that is a scanner failure, not "no findings".
                return {
                    'error': f'gitleaks failed with exit code {result.returncode}.',
                    'exit_code': result.returncode,
                    'raw_output': stderr_tail,
                }

            # gitleaks reports the ABSOLUTE scanned path.  Rewrite it to a
            # project-relative path so results are portable and the UI never
            # shows the server's temp directory.  The original value is kept
            # as `absolute_path` for debugging.
            root = os.path.abspath(self.project_path)
            for finding in results:
                if not isinstance(finding, dict):
                    continue
                raw_path = finding.get('File')
                if not raw_path:
                    continue
                # A relative path (no drive/anchor) is already portable —
                # leave it exactly as reported.
                if not os.path.isabs(raw_path):
                    continue
                absolute = os.path.abspath(raw_path)
                if os.path.normcase(absolute).startswith(os.path.normcase(root)):
                    relative = os.path.relpath(absolute, root)
                else:
                    relative = os.path.basename(absolute)
                normalized = relative.replace('\\', '/')
                if normalized != raw_path:
                    finding['absolute_path'] = raw_path
                finding['File'] = normalized

            return {
                'total_vulnerabilities': len(results),
                'severity_counts': {
                    'critical': len(results) # Gitleaks findings are generally critical secrets
                },
                'all_vulnerabilities': results,
                'exit_code': result.returncode,
            }

        except subprocess.TimeoutExpired:
            return {
                'error': f'Gitleaks scan timed out after {GITLEAKS_TIMEOUT} seconds.'
            }
        except Exception as e:
            return {
                'error': str(e)
            }
        finally:
            if report_path and os.path.exists(report_path):
                try:
                    os.remove(report_path)
                except OSError:
                    pass
