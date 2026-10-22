"""
ZIP archive validation and safe extraction helpers.

Design goals:
  * ``inspect_zip`` / ``validate_zip`` only read the archive's central
    directory — they never extract anything, which makes them cheap enough
    to run inside the request/response cycle.
  * ``safe_extract_zip`` is the ONLY supported way to materialise an
    archive on disk.  It rejects absolute paths, drive letters and
    ``..`` traversal (zip-slip) and enforces a decompressed-size budget
    (zip-bomb protection).
"""
import os
import posixpath
import shutil
import zipfile

LANGUAGE_MAP = {
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".java": "Java",
    ".php": "PHP",
    ".go": "Go",
    ".rb": "Ruby",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".html": "HTML",
    ".css": "CSS",
}

# Safety limits for uploaded archives.
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  # 500 MB of expanded content
MAX_ZIP_ENTRIES = 100_000                    # reasonable upper bound on files


class InvalidZipArchive(Exception):
    """Raised when an archive is unusable or fails a safety check."""


def _unsafe_path_reason(raw_name):
    """
    Return a human-readable reason when a ZIP entry name could escape the
    extraction directory, otherwise ``None``.
    """
    if not raw_name:
        return None
    # ZIP spec uses '/', but Windows-created archives may use backslashes.
    normalized = raw_name.replace('\\', '/')

    if normalized.startswith('/') or normalized.startswith('../') or normalized == '..':
        return 'absolute or parent-relative path'

    # Reject Windows drive-letter paths such as 'C:/Windows/evil.dll'.
    if len(normalized) >= 2 and normalized[1] == ':':
        return 'drive-letter path'

    # normpath collapses 'foo/../bar'; any surviving '..' means traversal.
    parts = posixpath.normpath(normalized).split('/')
    if '..' in parts:
        return 'path traversal'

    return None


def inspect_zip(zip_path):
    """
    Validate an uploaded archive by reading only its central directory.

    Returns the same shape as the historical ``validate_zip`` payload::

        {'isValid', 'languages', 'fileCount', 'totalSize', 'errors', 'warnings'}

    Raises :class:`InvalidZipArchive` when the file is missing, is not a
    ZIP at all, contains unsafe paths or exceeds the safety limits.
    """
    if not zip_path or not os.path.isfile(zip_path):
        raise InvalidZipArchive('Uploaded archive could not be found on the server.')

    if not zipfile.is_zipfile(zip_path):
        raise InvalidZipArchive('Uploaded file is not a valid ZIP archive.')

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            infos = zip_ref.infolist()
    except zipfile.BadZipFile:
        raise InvalidZipArchive('Uploaded file is not a valid ZIP archive.')

    if len(infos) > MAX_ZIP_ENTRIES:
        raise InvalidZipArchive(
            f'Archive contains too many entries ({len(infos)}); '
            f'limit is {MAX_ZIP_ENTRIES}.'
        )

    languages = set()
    file_count = 0
    total_size = 0

    for info in infos:
        reason = _unsafe_path_reason(info.filename)
        if reason:
            raise InvalidZipArchive(
                f'Archive contains an unsafe entry path ({reason}): {info.filename}'
            )
        if info.is_dir():
            continue
        file_count += 1
        total_size += info.file_size
        _, ext = os.path.splitext(info.filename)
        language = LANGUAGE_MAP.get(ext.lower())
        if language:
            languages.add(language)

    if total_size > MAX_UNCOMPRESSED_BYTES:
        raise InvalidZipArchive(
            'Archive expands to more than '
            f'{MAX_UNCOMPRESSED_BYTES // (1024 * 1024)} MB, which exceeds the limit.'
        )

    if file_count == 0:
        raise InvalidZipArchive('Archive does not contain any files.')

    return {
        'isValid': True,
        'languages': sorted(languages),
        'fileCount': file_count,
        'totalSize': total_size,
        'errors': [],
        'warnings': [],
    }


def validate_zip(zip_path):
    """
    Backwards-compatible wrapper around :func:`inspect_zip`.

    Never raises: invalid archives are reported through the ``errors`` /
    ``isValid`` fields of the returned dictionary.
    """
    try:
        return inspect_zip(zip_path)
    except InvalidZipArchive as exc:
        return {
            'isValid': False,
            'languages': [],
            'fileCount': 0,
            'totalSize': 0,
            'errors': [{'title': 'Invalid ZIP', 'message': str(exc)}],
            'warnings': [],
        }
    except zipfile.BadZipFile:
        return {
            'isValid': False,
            'languages': [],
            'fileCount': 0,
            'totalSize': 0,
            'errors': [{'title': 'Invalid ZIP', 'message': 'Uploaded file is not a valid ZIP archive.'}],
            'warnings': [],
        }


def safe_extract_zip(zip_path, dest_dir):
    """
    Extract ``zip_path`` into ``dest_dir`` with zip-slip protection and a
    decompressed-size budget.  Returns the number of files written.

    Extraction is restricted to ``dest_dir``; any entry that would resolve
    outside of it aborts the extraction with :class:`InvalidZipArchive`.
    """
    if not os.path.isdir(dest_dir):
        raise InvalidZipArchive('Extraction directory does not exist.')

    dest_root = os.path.realpath(dest_dir)
    files_written = 0
    bytes_written = 0

    try:
        zip_ref = zipfile.ZipFile(zip_path, 'r')
    except (zipfile.BadZipFile, OSError):
        raise InvalidZipArchive('Uploaded file is not a valid ZIP archive.')

    with zip_ref:
        # Pass 1 — verify every entry resolves inside dest_root before
        # writing a single byte.
        for info in zip_ref.infolist():
            reason = _unsafe_path_reason(info.filename)
            if reason:
                raise InvalidZipArchive(
                    f'Archive contains an unsafe entry path ({reason}): {info.filename}'
                )
            target = os.path.realpath(os.path.join(dest_root, info.filename))
            if target != dest_root and not target.startswith(dest_root + os.sep):
                raise InvalidZipArchive(
                    f'Archive entry attempts to escape the extraction directory: {info.filename}'
                )

        # Pass 2 — stream entries to disk while enforcing the size budget.
        for info in zip_ref.infolist():
            target = os.path.realpath(os.path.join(dest_root, info.filename))
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue

            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zip_ref.open(info) as src, open(target, 'wb') as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_written += len(chunk)
                    if bytes_written > MAX_UNCOMPRESSED_BYTES:
                        raise InvalidZipArchive(
                            'Archive expanded beyond the allowed size while extracting.'
                        )
                    dst.write(chunk)
            files_written += 1

    return files_written
