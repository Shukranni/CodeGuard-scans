"""
Authoritative normalisation of a scan's stored result into findings.

The frontend used to normalise scanner output on its own (duplicated in two
places: the scan-results page and the Code Explorer).  That made it impossible
for the backend to reason about a finding, and it let the two views drift
apart.  This module is the single source of truth: the API resolves a finding
by the very same identifier the UI displays (``semgrep_3``, ``gitleaks_0``,
``dep_<package>``), so an explanation can always be tied back to the exact
scanner output it describes.

Nothing here fabricates metadata: fields the scanners did not report are
returned as ``None`` so the UI can say "not provided" instead of inventing a
CWE id, a line number or an OWASP category.
"""
import os
import re

# ── Severity mapping ──────────────────────────────────────────────────────────
# Semgrep reports INFO / WARNING / ERROR, npm audit reports
# low / moderate / high / critical, Gitleaks findings are always critical.

_SEVERITY_RANK = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1, 'info': 0}

# Weight of a single finding, by severity.  The scale is shared with the
# dashboard overview so that a scan's own risk score and the overview's
# "average risk score" metric are directly comparable.
SEVERITY_WEIGHTS = {'critical': 40, 'high': 20, 'medium': 10, 'low': 5, 'info': 2}


def map_severity(severity, scanner):
    """Map a raw scanner severity onto CodeGuard's severity scale."""
    value = (severity or '').strip().lower()
    scanner = (scanner or '').strip().lower()

    if scanner == 'semgrep':
        if value == 'error':
            return 'critical'
        if value == 'warning':
            return 'high'
        if value == 'info':
            return 'low'
        return 'medium'

    if scanner == 'gitleaks':
        return 'critical'

    if scanner == 'dependency':
        if value == 'critical':
            return 'critical'
        if value == 'high':
            return 'high'
        if value == 'moderate':
            return 'medium'
        if value == 'low':
            return 'low'
        return 'medium'

    known = {
        'critical': 'critical', 'high': 'high', 'medium': 'medium',
        'low': 'low', 'error': 'critical', 'warning': 'high', 'info': 'low',
    }
    return known.get(value, 'medium')


def severity_rank(severity):
    """Numeric rank used for sorting (higher = more severe)."""
    return _SEVERITY_RANK.get((severity or '').lower(), 0)


# ── Path helpers ──────────────────────────────────────────────────────────────

def normalize_path(path):
    """Normalise a scanner path to a forward-slash, relative project path."""
    if not path:
        return ''
    value = str(path).replace('\\', '/')
    # Strip a leading drive letter / absolute prefix produced by Windows tools.
    value = re.sub(r'^[A-Za-z]:/', '', value)
    value = re.sub(r'^/+', '', value)
    parts = [part for part in value.split('/') if part not in ('', '.')]
    return '/'.join(parts)


def language_from_path(path):
    """Best-effort language label derived from the file extension."""
    extension = os.path.splitext(path or '')[1].lower()
    return _LANGUAGE_BY_EXTENSION.get(extension)


_LANGUAGE_BY_EXTENSION = {
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
    '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.py': 'Python', '.java': 'Java', '.php': 'PHP', '.html': 'HTML',
    '.htm': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.c': 'C', '.cpp': 'C++',
    '.cc': 'C++', '.h': 'C', '.hpp': 'C++', '.go': 'Go', '.rb': 'Ruby',
    '.rs': 'Rust', '.sh': 'Shell', '.bash': 'Shell', '.ps1': 'PowerShell',
    '.json': 'JSON', '.xml': 'XML', '.yml': 'YAML', '.yaml': 'YAML',
    '.md': 'Markdown', '.txt': 'Text', '.toml': 'TOML', '.ini': 'INI',
    '.cfg': 'Config', '.env': 'ENV', '.sql': 'SQL', '.kt': 'Kotlin',
    '.swift': 'Swift', '.scala': 'Scala', '.dart': 'Dart', '.vue': 'Vue',
    '.svelte': 'Svelte', '.tf': 'Terraform', '.dockerfile': 'Dockerfile',
}


# ── Small text helpers ────────────────────────────────────────────────────────

def first_sentence(text):
    """Return the first sentence of a scanner message (used as the title)."""
    if not text:
        return ''
    cleaned = ' '.join(str(text).split())
    match = re.split(r'(?<=[.!?])\s', cleaned, maxsplit=1)
    return match[0].strip() if match else cleaned


def _clean_snippet(value):
    """
    Return a usable code snippet or an empty string.

    Semgrep OSS returns the literal string ``"requires login"`` in ``extra.lines``
    when the rule metadata is not available.  Showing that to the user as the
    vulnerable code would be misleading, so it is treated as "not provided".
    """
    if not value or not isinstance(value, str):
        return ''
    stripped = value.strip()
    if not stripped:
        return ''
    if stripped.lower() in ('requires login', 'requires-login', 'unknown'):
        return ''
    return value


def _as_list(value):
    """Coerce a metadata field into a list of strings."""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if item is not None]
    return [str(value)]


def _first(value):
    items = _as_list(value)
    return items[0] if items else None


def _references(metadata):
    """Extract reference URLs from semgrep metadata."""
    urls = []
    for item in _as_list(metadata.get('references')):
        if item.startswith('http'):
            urls.append(item)
    source = metadata.get('source')
    if isinstance(source, str) and source.startswith('http') and source not in urls:
        urls.append(source)
    return urls


# ── Scanner specific normalisation ────────────────────────────────────────────

def _semgrep_findings(scanners_data, dismissed):
    findings = []
    semgrep = scanners_data.get('semgrep')
    if not isinstance(semgrep, dict):
        return findings

    for index, raw in enumerate(semgrep.get('all_vulnerabilities') or []):
        if not isinstance(raw, dict):
            continue
        extra = raw.get('extra') or {}
        metadata = extra.get('metadata') or {}
        finding_id = f'semgrep_{index}'
        message = extra.get('message') or 'Security issue detected'
        start = raw.get('start') or {}
        end = raw.get('end') or {}
        file_path = normalize_path(raw.get('path'))

        findings.append({
            'id': finding_id,
            'scanner': 'Semgrep',
            'title': first_sentence(message) or 'Security issue detected',
            'severity': map_severity(extra.get('severity'), 'semgrep'),
            'file': file_path,
            'line': start.get('line'),
            'end_line': end.get('line') or start.get('line'),
            'description': message,
            'code_snippet': _clean_snippet(extra.get('lines')),
            'remediation': metadata.get('remediation') or None,
            'cwe': _first(metadata.get('cwe')),
            'owasp': _first(metadata.get('owasp')),
            'rule_id': raw.get('check_id') or None,
            'language': language_from_path(file_path),
            'confidence': metadata.get('confidence') or None,
            'references': _references(metadata),
            'dismissed': finding_id in dismissed,
        })
    return findings


def _gitleaks_findings(scanners_data, dismissed):
    findings = []
    gitleaks = scanners_data.get('gitleaks')
    if not isinstance(gitleaks, dict):
        return findings

    for index, raw in enumerate(gitleaks.get('all_vulnerabilities') or []):
        if not isinstance(raw, dict):
            continue
        finding_id = f'gitleaks_{index}'
        description = raw.get('Description') or 'Credential'
        file_path = normalize_path(raw.get('File'))
        start_line = raw.get('StartLine')
        end_line = raw.get('EndLine') or start_line
        secret = raw.get('Secret') or ''

        # The matched line is shown with the secret value masked — the raw
        # credential never reaches the browser or the AI provider.
        snippet = _clean_snippet(raw.get('Match'))
        if snippet and secret:
            snippet = snippet.replace(secret, '[REDACTED]')

        findings.append({
            'id': finding_id,
            'scanner': 'GitLeaks',
            'title': f'Exposed Secret: {description}',
            'severity': 'critical',
            'file': file_path,
            'line': start_line,
            'end_line': end_line,
            'description': (
                f'{description} detected in {file_path or "the project"}. '
                'The value is committed in source control and must be treated '
                'as compromised.'
            ),
            'code_snippet': snippet,
            'remediation': (
                'Remove the hardcoded secret, rotate the credential and load it '
                'from an environment variable or a secret manager instead.'
            ),
            'cwe': 'CWE-798',
            'owasp': 'A02:2021 - Cryptographic Failures',
            'rule_id': raw.get('RuleID') or None,
            'language': language_from_path(file_path),
            'confidence': None,
            'references': [],
            'dismissed': finding_id in dismissed,
            # The raw secret is never returned to the browser.
            'secret_detected': bool(secret),
        })
    return findings


def _dependency_findings(scanners_data, dismissed):
    findings = []
    dependency = scanners_data.get('dependency')
    if not isinstance(dependency, dict):
        return findings

    vulnerabilities = dependency.get('all_vulnerabilities')
    if not isinstance(vulnerabilities, dict):
        return findings

    for package, info in vulnerabilities.items():
        if not isinstance(info, dict):
            info = {}
        finding_id = f'dep_{package}'
        version_range = info.get('range') or ''
        severity = map_severity(info.get('severity'), 'dependency')

        advisories = []
        for via in info.get('via') or []:
            if isinstance(via, dict):
                advisories.append({
                    'title': via.get('title') or None,
                    'url': via.get('url') or None,
                    'severity': via.get('severity') or None,
                    'cwe': _as_list(via.get('cwe')),
                    'cvss_score': (via.get('cvss') or {}).get('score')
                    if isinstance(via.get('cvss'), dict) else None,
                })

        findings.append({
            'id': finding_id,
            'scanner': 'Dependency',
            'title': f'Vulnerable Dependency: {package} {version_range}'.strip(),
            'severity': severity,
            'file': 'package-lock.json',
            'line': None,
            'end_line': None,
            'description': (
                f'The npm package "{package}" (installed range {version_range or "unknown"}) '
                'has known security advisories.'
            ),
            'code_snippet': f'"{package}": "{version_range}"',
            'remediation': (
                f'Update {package} to a version that is not affected by the reported advisories.'
                if version_range else f'Update {package} to a patched version.'
            ),
            'cwe': 'CWE-1104',
            'owasp': 'A06:2021 - Vulnerable and Outdated Components',
            'rule_id': package,
            'language': 'npm',
            'confidence': None,
            'references': [a['url'] for a in advisories if a.get('url')],
            'dismissed': finding_id in dismissed,
            'advisories': advisories,
            'fix_available': bool(info.get('fixAvailable')),
        })
    return findings


# ── Public API ────────────────────────────────────────────────────────────────

def normalize_scan_findings(scan):
    """
    Return every finding of ``scan`` as a list of normalised dictionaries.

    The list is ordered by severity (most severe first) and then by the
    scanner's own order, which keeps the UI stable between requests.
    """
    result = scan.result if hasattr(scan, 'result') else scan
    scanners_data = (result or {}).get('scans') or {}
    if not isinstance(scanners_data, dict):
        scanners_data = {}

    dismissed = set(getattr(scan, 'dismissed_findings', None) or [])

    findings = []
    findings.extend(_semgrep_findings(scanners_data, dismissed))
    findings.extend(_gitleaks_findings(scanners_data, dismissed))
    findings.extend(_dependency_findings(scanners_data, dismissed))

    findings.sort(key=lambda item: -severity_rank(item.get('severity')))
    return findings


def summarize_scan(scan):
    """
    Return the severity counts and the risk score of ``scan``.

    Dismissed findings are left out: they were triaged away and must not be
    counted again.

    The risk score is the weighted sum of the remaining findings, capped at
    100 — the higher the score, the worse the scan.  It uses the same weights
    as the dashboard overview, so the two numbers always mean the same thing.

    Nothing is invented: a scan without a stored result simply reports zeros.
    """
    result = scan.result if hasattr(scan, 'result') else scan
    counts = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0, 'info': 0}
    weighted_points = 0

    for finding in normalize_scan_findings(scan):
        if finding.get('dismissed'):
            continue
        severity = (finding.get('severity') or 'medium').lower()
        counts[severity] = counts.get(severity, 0) + 1
        weighted_points += SEVERITY_WEIGHTS.get(severity, 0)

    validation = (result or {}).get('validation') or {}

    return {
        'riskScore': min(100, weighted_points),
        'findings': {
            **counts,
            'total': sum(counts.values()),
        },
        'fileCount': validation.get('fileCount') or 0,
    }


def find_finding(scan, finding_id):
    """
    Return the normalised finding ``finding_id`` of ``scan`` or ``None``.

    The lookup is by the stable identifier shown in the UI.  Because the scan
    itself is always owner-scoped before this function is called, a finding id
    can never be used to reach another user's data.
    """
    if not finding_id:
        return None
    needle = str(finding_id)
    for finding in normalize_scan_findings(scan):
        if finding['id'] == needle:
            return finding
    return None


def public_finding(finding):
    """
    Strip internal-only fields before a finding is sent to the browser.

    The raw secret detected by Gitleaks is never included — only the fact
    that a secret was found.
    """
    if not finding:
        return None
    payload = {key: value for key, value in finding.items() if key != 'secret_detected'}
    payload['secret_detected'] = bool(finding.get('secret_detected'))
    return payload
