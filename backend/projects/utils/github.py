"""
Fetch a GitHub repository and turn it into a scannable source archive.

The scan pipeline only ever consumes a ZIP archive (``Project.zip_file``), so a
repository is fetched into a temporary directory and archived exactly like an
uploaded archive.  That keeps validation, extraction and scanning on a single
code path instead of adding a second one for repositories.

Security
--------
* The user never controls the URL that is fetched.  Only ``owner`` and
  ``repo`` are taken from the input, they are validated against a strict
  pattern and the request URL is rebuilt from scratch — so this endpoint
  cannot be turned into an SSRF proxy for arbitrary hosts.
* The optional access token is used for the request only.  It is never
  written to the database, never logged and never included in an error
  message that reaches the client.
* The archive is built here, so every entry is a relative path by
  construction.  The extraction side (``safe_extract_zip``) validates
  everything again before a single byte is written to disk.
"""
import base64
import logging
import os
import re
import shutil
import subprocess
import tarfile
import zipfile
from urllib.parse import urlparse

logger = logging.getLogger('projects.github')

# ── Limits ────────────────────────────────────────────────────────────────────
# The archive limit matches the upload limit of the ZIP endpoint so both
# sources are treated identically by the storage layer.
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
# The uncompressed budget matches the zip-bomb protection of the scanner.
MAX_SOURCE_BYTES = 500 * 1024 * 1024
# Maximum number of files that end up in the archive.
MAX_ARCHIVE_ENTRIES = 100_000
# Seconds a single clone / download may take.
CLONE_TIMEOUT_SECONDS = int(os.environ.get('CODEGUARD_GITHUB_TIMEOUT', '120'))
DOWNLOAD_TIMEOUT_SECONDS = int(os.environ.get('CODEGUARD_GITHUB_DOWNLOAD_TIMEOUT', '90'))

# Only github.com may be fetched from.
GITHUB_HOSTS = {'github.com', 'www.github.com'}
GITHUB_API_BASE = 'https://api.github.com'

# GitHub owner names: alphanumeric with single dashes, max 39 characters.
OWNER_PATTERN = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$')
# Repository names may contain dots, dashes and underscores.
REPOSITORY_PATTERN = re.compile(r'^[A-Za-z0-9_.-]{1,100}$')
# Branch / tag names.  ".." is rejected separately because it is a path
# traversal, not a valid ref anyway.
REF_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$')

# Directories that are never scanned.  These are the same directories the
# scanner runner deletes after extraction, so excluding them here keeps the
# archive small without changing what is actually analysed.
EXCLUDED_DIR_NAMES = {
    '.git', '.hg', '.svn',
    'node_modules', 'bower_components', 'vendor',
    '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox',
    '.venv', 'venv', 'env', '.eggs',
    'dist', 'build', 'out', 'target',
    '.next', '.nuxt', '.svelte-kit', '.parcel-cache',
    '.gradle', '.terraform', '.idea', '.vscode',
    'coverage', '.nyc_output', '.cache',
}


class GitHubRepositoryError(Exception):
    """
    Raised when a repository cannot be fetched.

    The message is written for the end user and is safe to return through the
    API — it never contains the access token or a server filesystem path.
    ``status_code`` tells the view which HTTP status describes the problem
    best (400 for a bad request, 413 for a repository that is too large).
    """

    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


# ── URL parsing ───────────────────────────────────────────────────────────────

def _split_repository_path(path):
    """
    Split ``owner/repo`` (plus an optional ref) out of a URL path.

    Returns ``(owner, repo, ref)`` where ``ref`` may be ``None``.
    """
    segments = [segment for segment in path.split('/') if segment]
    if len(segments) < 2:
        raise GitHubRepositoryError(
            'That does not look like a GitHub repository. '
            'Expected a URL such as https://github.com/owner/repository.'
        )

    owner = segments[0]
    repo = segments[1]
    ref = None

    # https://github.com/owner/repo/tree/branch[/path]
    # Only the first segment after "tree"/"blob" is the branch — the rest of
    # the URL is a path inside the repository, not part of the ref.
    if len(segments) > 3 and segments[2] in ('tree', 'blob'):
        ref = segments[3]

    if repo.lower().endswith('.git'):
        repo = repo[:-4]

    return owner, repo, ref


def _validate_owner(owner):
    if not OWNER_PATTERN.match(owner):
        raise GitHubRepositoryError('The repository owner name is not valid.')
    return owner


def _validate_repository(repo):
    if not REPOSITORY_PATTERN.match(repo) or repo in ('.', '..'):
        raise GitHubRepositoryError('The repository name is not valid.')
    return repo


def _validate_ref(ref):
    if ref is None:
        return None
    if not REF_PATTERN.match(ref) or '..' in ref:
        raise GitHubRepositoryError('The branch or tag name is not valid.')
    return ref


def parse_repository_url(raw_url):
    """
    Parse a GitHub repository URL into its parts.

    Accepted forms::

        https://github.com/owner/repo
        https://github.com/owner/repo.git
        http://github.com/owner/repo
        https://www.github.com/owner/repo/
        git@github.com:owner/repo.git
        github.com/owner/repo
        owner/repo
        https://github.com/owner/repo/tree/main

    Returns a dictionary with ``owner``, ``repo`` and an optional ``ref``.
    Raises :class:`GitHubRepositoryError` with a user-facing message when the
    input is not a GitHub repository URL.
    """
    if raw_url is None or not str(raw_url).strip():
        raise GitHubRepositoryError('Enter the URL of the repository you want to scan.')

    value = str(raw_url).strip()

    # scp-style syntax: git@github.com:owner/repo.git
    if value.startswith('git@'):
        host, separator, path = value[4:].partition(':')
        if not separator:
            raise GitHubRepositoryError(
                'That does not look like a GitHub repository. '
                'Expected a URL such as https://github.com/owner/repository.'
            )
        if host.lower() not in GITHUB_HOSTS:
            raise GitHubRepositoryError('Only repositories hosted on github.com can be scanned.')
        owner, repo, ref = _split_repository_path(path)
    else:
        # "github.com/owner/repo" and "owner/repo" are accepted as a
        # convenience; everything else is parsed as a URL.
        if '://' not in value:
            if value.lower().startswith('github.com/'):
                value = 'https://' + value
            elif '/' in value and '.' not in value.split('/')[0]:
                value = f'https://github.com/{value}'
            else:
                raise GitHubRepositoryError(
                    'That does not look like a GitHub repository. '
                    'Expected a URL such as https://github.com/owner/repository.'
                )

        parsed = urlparse(value)
        host = (parsed.hostname or '').lower()
        if host not in GITHUB_HOSTS:
            raise GitHubRepositoryError('Only repositories hosted on github.com can be scanned.')

        owner, repo, ref = _split_repository_path(parsed.path)

    return {
        'owner': _validate_owner(owner),
        'repo': _validate_repository(repo),
        'ref': _validate_ref(ref),
    }


# ── Fetching ──────────────────────────────────────────────────────────────────

def _scrub(text, token):
    """Remove the access token from any text that may reach the client."""
    if not text:
        return ''
    cleaned = str(text)
    if token:
        cleaned = cleaned.replace(token, '[token]')
        cleaned = cleaned.replace(token.strip(), '[token]')
    return cleaned.strip()


def _git_auth_arguments(token):
    """
    Build the ``git -c`` arguments that authenticate a clone.

    The token is sent as an ``Authorization`` header instead of being embedded
    in the clone URL, so it never ends up in a remote URL, in ``.git/config``
    or in an error message that echoes the URL.
    """
    if not token:
        return []

    credentials = base64.b64encode(f'x-access-token:{token}'.encode('utf-8')).decode('ascii')
    return [
        '-c', f'http.extraHeader=Authorization: Basic {credentials}',
        # Never let a local credential helper answer the request.
        '-c', 'credential.helper=',
    ]


def _clone_with_git(owner, repo, ref, token, destination, timeout):
    """
    Clone the repository into ``destination`` using the ``git`` executable.

    Returns ``True`` on success.  A missing ``git`` binary or a failed clone
    returns ``False`` so the caller can fall back to the API download.
    """
    git_binary = shutil.which('git')
    if not git_binary:
        logger.info('git executable not found — falling back to the GitHub API')
        return False

    command = [git_binary, *_git_auth_arguments(token)]
    command += ['clone', '--depth', '1', '--single-branch', '--no-tags', '--quiet']
    if ref:
        command += ['--branch', ref]
    command += ['--', f'https://github.com/{owner}/{repo}.git', destination]

    environment = os.environ.copy()
    # Never block waiting for a credential prompt — fail fast instead.
    environment['GIT_TERMINAL_PROMPT'] = '0'
    environment['GCM_INTERACTIVE'] = 'never'
    environment['GIT_LFS_SKIP_SMUDGE'] = '1'

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            timeout=timeout,
            env=environment,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise GitHubRepositoryError(
            f'Cloning the repository took longer than {timeout} seconds and was cancelled.'
        )
    except OSError as exc:
        logger.warning('Could not run git: %s', exc)
        return False

    if result.returncode == 0:
        return True

    stderr = _scrub(result.stderr.decode('utf-8', errors='replace'), token)
    logger.warning('git clone failed for %s/%s: %s', owner, repo, stderr)

    lowered = stderr.lower()
    if 'not found' in lowered and 'repository' in lowered:
        raise GitHubRepositoryError(
            f'The repository {owner}/{repo} does not exist or is not public.'
        )
    if 'authentication failed' in lowered or 'could not read username' in lowered:
        raise GitHubRepositoryError(
            'GitHub refused the request. Provide a token with the "repo" scope for private '
            'repositories, or check that the repository is public.'
        )
    if 'remote branch' in lowered and 'not found' in lowered:
        raise GitHubRepositoryError(
            f'The branch or tag "{ref}" does not exist in {owner}/{repo}.'
        )
    if 'permission denied' in lowered:
        raise GitHubRepositoryError(
            'The access token does not have permission to read this repository.'
        )

    # Anything else (network hiccup, git version issues, ...) is not fatal —
    # the API fallback may still succeed.
    return False


def _strip_first_component(name):
    """Remove the leading ``owner-repo-sha/`` folder of a GitHub tarball."""
    parts = [part for part in name.replace('\\', '/').split('/') if part]
    if len(parts) <= 1:
        return ''
    return '/'.join(parts[1:])


def _extract_tarball(stream, destination, max_bytes):
    """
    Extract a GitHub tarball into ``destination`` safely.

    Only regular files and directories are extracted — symlinks, devices and
    hard links are skipped, so a malicious archive cannot write outside the
    destination directory.  The first path component (the ``owner-repo-sha``
    wrapper GitHub adds) is stripped so the source lands at the root.
    """
    root = os.path.realpath(destination)
    written = 0

    with tarfile.open(fileobj=stream, mode='r:*') as archive:
        for member in archive:
            if not (member.isfile() or member.isdir()):
                continue

            relative = _strip_first_component(member.name)
            if not relative:
                continue

            target = os.path.realpath(os.path.join(root, relative))
            if target != root and not target.startswith(root + os.sep):
                raise GitHubRepositoryError(
                    'The repository archive contains an unsafe path and was rejected.'
                )

            if member.isdir():
                os.makedirs(target, exist_ok=True)
                continue

            source = archive.extractfile(member)
            if source is None:
                continue

            os.makedirs(os.path.dirname(target), exist_ok=True)
            with source, open(target, 'wb') as destination_file:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > max_bytes:
                        raise GitHubRepositoryError(
                            'The repository is larger than the scan limit of '
                            f'{max_bytes // (1024 * 1024)} MB.',
                            status_code=413,
                        )
                    destination_file.write(chunk)


def _download_with_api(owner, repo, ref, token, destination, timeout):
    """
    Download the repository as a tarball through the GitHub API.

    Returns ``True`` on success, ``False`` when the request could not be
    completed.  Raises :class:`GitHubRepositoryError` for errors the user can
    act on (missing repository, bad credentials, rate limit).
    """
    try:
        import requests
    except ImportError:  # pragma: no cover - requests is a declared dependency
        logger.warning('The requests library is not installed.')
        return False

    if ref:
        url = f'{GITHUB_API_BASE}/repos/{owner}/{repo}/tarball/{ref}'
    else:
        url = f'{GITHUB_API_BASE}/repos/{owner}/{repo}/tarball'

    headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'CodeGuard-Scanner',
        'X-GitHub-Api-Version': '2022-11-28',
    }
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        response = requests.get(
            url,
            headers=headers,
            stream=True,
            timeout=(15, timeout),
            allow_redirects=True,
        )
    except requests.RequestException as exc:
        logger.warning('GitHub API request failed: %s', _scrub(exc, token))
        return False

    if response.status_code == 404:
        raise GitHubRepositoryError(
            f'The repository {owner}/{repo} does not exist or is not accessible.'
        )
    if response.status_code in (401, 403):
        if 'rate limit' in response.text.lower():
            raise GitHubRepositoryError(
                'GitHub rate-limited this request. Try again in a few minutes, '
                'or provide a personal access token.'
            )
        raise GitHubRepositoryError(
            'GitHub refused the request. Provide a token with the "repo" scope for private '
            'repositories, or check that the repository is public.'
        )
    if response.status_code >= 400:
        logger.warning('GitHub API returned %s', response.status_code)
        return False

    try:
        _extract_tarball(response.raw, destination, MAX_SOURCE_BYTES)
    except tarfile.ReadError:
        logger.warning('The downloaded repository archive could not be read.')
        return False

    return True


def fetch_repository(owner, repo, destination, ref=None, token=None, timeout=None):
    """
    Fetch a repository into ``destination``.

    The ``git`` executable is preferred because it also works for private
    repositories when a token is supplied and it is not rate limited.  When
    ``git`` is unavailable or fails, the GitHub API tarball is used instead.

    ``destination`` is created when it does not exist yet.  The caller owns
    the directory and is responsible for removing it.
    """
    timeout = timeout or CLONE_TIMEOUT_SECONDS
    token = (token or '').strip()

    os.makedirs(destination, exist_ok=True)

    try:
        if _clone_with_git(owner, repo, ref, token, destination, timeout):
            return destination

        logger.info('Falling back to the GitHub API tarball for %s/%s', owner, repo)
        # A failed clone can leave a partial checkout behind — start from a
        # clean directory so the tarball is not mixed with stale files.
        shutil.rmtree(destination, ignore_errors=True)
        os.makedirs(destination, exist_ok=True)
        if _download_with_api(owner, repo, ref, token, destination, DOWNLOAD_TIMEOUT_SECONDS):
            return destination

        raise GitHubRepositoryError(
            f'The repository {owner}/{repo} could not be downloaded. '
            'Check that it exists, that it is public (or that your token has the '
            '"repo" scope) and that this server can reach github.com.'
        )
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise


# ── Archiving ─────────────────────────────────────────────────────────────────

def build_source_archive(source_dir, destination_path):
    """
    Zip the source tree into ``destination_path``.

    Directories that are never scanned are skipped, and both the number of
    entries and the total size are capped so a huge repository cannot fill up
    the disk.  Returns the path of the written archive.
    """
    entries = 0
    total_bytes = 0
    destination_real = os.path.realpath(destination_path)

    with zipfile.ZipFile(destination_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for directory, subdirectories, filenames in os.walk(source_dir):
            subdirectories[:] = [
                name for name in subdirectories
                if name.lower() not in EXCLUDED_DIR_NAMES
            ]

            for filename in sorted(filenames):
                absolute = os.path.join(directory, filename)

                # Symlinks are skipped — they can point outside the repository.
                if os.path.islink(absolute) or not os.path.isfile(absolute):
                    continue

                # The archive must never contain itself.
                if os.path.realpath(absolute) == destination_real:
                    continue

                entries += 1
                if entries > MAX_ARCHIVE_ENTRIES:
                    raise GitHubRepositoryError(
                        f'The repository contains more than {MAX_ARCHIVE_ENTRIES} files, '
                        'which exceeds the scan limit.',
                        status_code=413,
                    )

                try:
                    total_bytes += os.path.getsize(absolute)
                except OSError:
                    continue

                if total_bytes > MAX_SOURCE_BYTES:
                    raise GitHubRepositoryError(
                        'The repository is larger than the scan limit of '
                        f'{MAX_SOURCE_BYTES // (1024 * 1024)} MB.',
                        status_code=413,
                    )

                relative = os.path.relpath(absolute, source_dir).replace(os.sep, '/')
                archive.write(absolute, relative)

    archive_size = os.path.getsize(destination_path)
    if archive_size > MAX_ARCHIVE_BYTES:
        raise GitHubRepositoryError(
            f'The repository archive is {archive_size // (1024 * 1024)} MB, which exceeds '
            f'the limit of {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.',
            status_code=413,
        )

    if entries == 0:
        raise GitHubRepositoryError('The repository does not contain any files to scan.')

    return destination_path
