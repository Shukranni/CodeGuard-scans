"""
Extract the real source code around a finding from the uploaded project.

Semgrep's JSON output frequently contains the placeholder ``"requires login"``
instead of the offending lines, and Gitleaks only reports the matched secret.
To give the AI (and the user) something concrete, the affected file is read
straight out of the project's ZIP archive — the same archive the scan was run
against — and a small window of lines around the finding is extracted.

Only a bounded window is read (never the whole project) and the result is
capped, so the amount of user code that leaves the backend is minimal.
"""
import os
import posixpath
import zipfile

from projects.utils.archive import local_archive_path

from .findings import language_from_path

# Maximum amount of source handed to the AI / shown in the UI.
MAX_CONTEXT_LINES = 40
MAX_CONTEXT_CHARS = 4000
# Lines of context shown before and after the finding.
CONTEXT_PADDING = 3
# Files larger than this are not decoded (binary or generated artefacts).
MAX_FILE_BYTES = 512 * 1024


def _normalize_entry(name):
    """Normalise a ZIP entry name the same way the scanner paths are normalised."""
    value = str(name).replace('\\', '/')
    value = posixpath.normpath(value).lstrip('/')
    if value in ('.', ''):
        return ''
    return value


def _match_entry(target, entries):
    """
    Find the ZIP entry that corresponds to ``target``.

    Archives downloaded from GitHub usually keep the repository folder as the
    first path segment (``repo/src/app.js``), so an exact match is not always
    possible.  The lookup therefore falls back to a suffix match and finally to
    a unique basename match.
    """
    if not target:
        return None

    if target in entries:
        return target

    suffix = '/' + target
    suffix_matches = [name for name in entries if name.endswith(suffix)]
    if len(suffix_matches) == 1:
        return suffix_matches[0]
    if suffix_matches:
        # Prefer the shallowest path (fewest segments) for determinism.
        return sorted(suffix_matches, key=lambda name: (name.count('/'), name))[0]

    basename = posixpath.basename(target)
    basename_matches = [name for name in entries if posixpath.basename(name) == basename]
    if len(basename_matches) == 1:
        return basename_matches[0]
    if basename_matches:
        return sorted(basename_matches, key=lambda name: (name.count('/'), name))[0]

    return None


def _read_archive_entry(project, target):
    """
    Return ``(entry_name, raw_bytes)`` for ``target`` inside the project's
    archive, or ``(None, None)`` when it cannot be read.

    The archive is materialised on local disk first (a temporary copy when the
    file lives in remote object storage), so this works with every storage
    backend.
    """
    try:
        with local_archive_path(project) as archive_path:
            if not archive_path or not os.path.isfile(archive_path):
                return None, None

            with zipfile.ZipFile(archive_path, 'r') as archive:
                entries = {}
                for info in archive.infolist():
                    if info.is_dir():
                        continue
                    normalized = _normalize_entry(info.filename)
                    if normalized and normalized not in entries:
                        entries[normalized] = info

                matched = _match_entry(target, entries)
                if not matched:
                    return None, None

                info = entries[matched]
                if info.file_size > MAX_FILE_BYTES:
                    return None, None

                with archive.open(info) as handle:
                    raw = handle.read(MAX_FILE_BYTES)

                return matched, raw
    except (zipfile.BadZipFile, OSError):
        return None, None
    except Exception:
        return None, None


def extract_source_context(project, file_path, start_line=None, end_line=None,
                           max_lines=MAX_CONTEXT_LINES, max_chars=MAX_CONTEXT_CHARS):
    """
    Return the source window around a finding, or ``None`` when unavailable.

    The returned dictionary has the shape::

        {
            'path': 'src/app.js',       # path inside the archive
            'language': 'JavaScript',
            'start_line': 40,            # first line of the window (1-based)
            'end_line': 52,              # last line of the window (1-based)
            'code': '...',               # the window itself
            'truncated': False,          # True when the window was cut short
        }
    """
    if project is None or not file_path:
        return None

    target = str(file_path).replace('\\', '/').lstrip('/')

    matched, raw = _read_archive_entry(project, target)
    if matched is None or raw is None:
        return None

    try:
        content = raw.decode('utf-8')
    except UnicodeDecodeError:
        try:
            content = raw.decode('latin-1')
        except Exception:
            return None

    if '\x00' in content[:4096]:
        # Binary payload — not useful as source context.
        return None

    lines = content.splitlines()
    if not lines:
        return None

    try:
        first = int(start_line) if start_line else 1
    except (TypeError, ValueError):
        first = 1
    try:
        last = int(end_line) if end_line else first
    except (TypeError, ValueError):
        last = first
    if last < first:
        last = first

    window_start = max(1, first - CONTEXT_PADDING)
    window_end = min(len(lines), last + CONTEXT_PADDING)

    truncated = False
    if window_end - window_start + 1 > max_lines:
        window_end = window_start + max_lines - 1
        truncated = True

    snippet_lines = lines[window_start - 1:window_end]
    code = '\n'.join(snippet_lines)
    if len(code) > max_chars:
        code = code[:max_chars]
        truncated = True

    return {
        'path': matched,
        'language': language_from_path(matched),
        'start_line': window_start,
        'end_line': window_end,
        'code': code,
        'truncated': truncated,
    }
