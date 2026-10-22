"""
Dispatch Semgrep runs to GitHub Actions.

Free hosting boxes have just enough memory to keep the API alive and not
enough to run Semgrep comfortably on a real project; GitHub's CI runners
(2 cores, 7 GB of RAM) have plenty — and for a **public** repository every
minute of runner time is free (private repositories get 2,000 minutes per
month on the GitHub Free plan).

The scan worker talks to GitHub's REST API in two steps:

``dispatch()``
    ``POST /repos/{repo}/actions/workflows/{file}/dispatches`` queues
    ``.github/workflows/semgrep-scan.yml`` with the archive URL, the
    Semgrep arguments and a scan identifier.

``wait_for_result()``
    Polls the triggered run until it completes, then downloads the
    ``semgrep-output`` artifact and hands the raw Semgrep JSON back to the
    caller.

Configuration (all three are required before :func:`enabled` returns True):

``CODEGUARD_GITHUB_TOKEN``
    Personal access token (classic) with the ``repo`` scope.
``CODEGUARD_GITHUB_ACTIONS_REPO``
    Target repository, e.g. ``Shukranni/CodeGuard-scans``.
``CODEGUARD_PUBLIC_API_BASE``
    Public base URL of this API — the runner fetches the project archive
    from here through a short-lived signed link (see ``archive_link``).

Every network or protocol problem is reported as
:class:`GitHubActionsError` so the caller can fall back to a local Semgrep
installation instead of failing the scan.
"""
import io
import os
import time
import zipfile
from datetime import datetime, timedelta, timezone

import requests

API_ROOT = 'https://api.github.com'
DEFAULT_WORKFLOW_FILE = 'semgrep-scan.yml'
DEFAULT_REF = 'main'
DEFAULT_POLL_SECONDS = 5.0
DEFAULT_HTTP_TIMEOUT = 30

# The artifact the workflow uploads and the files inside it.
ARTIFACT_NAME = 'semgrep-output'
STDOUT_FILE = 'semgrep.json'
EXIT_CODE_FILE = 'rc.txt'
STDERR_FILE = 'err.txt'

# The artifacts endpoint can lag a heartbeat behind the ``completed``
# status, so a missing artifact is retried briefly before giving up.
ARTIFACT_RETRY_ATTEMPTS = 3
ARTIFACT_RETRY_SECONDS = 3.0

# How far back a dispatched run may have been created and still be
# considered "ours" when no scan-id tag matches (absorbs clock skew
# between this machine and GitHub).
RUN_MATCH_SKEW_SECONDS = 120


class GitHubActionsError(Exception):
    """A problem talking to GitHub Actions (never a Semgrep result)."""


def _env(name, default=''):
    return (os.environ.get(name) or default).strip() or default


def token():
    return _env('CODEGUARD_GITHUB_TOKEN')


def repository():
    return _env('CODEGUARD_GITHUB_ACTIONS_REPO')


def public_api_base():
    return _env('CODEGUARD_PUBLIC_API_BASE').rstrip('/')


def workflow_file():
    return _env('CODEGUARD_GITHUB_ACTIONS_WORKFLOW', DEFAULT_WORKFLOW_FILE)


def ref():
    return _env('CODEGUARD_GITHUB_ACTIONS_REF', DEFAULT_REF)


def enabled():
    """True only when remote dispatching is fully configured."""
    return bool(token() and repository() and public_api_base())


def poll_interval():
    try:
        return max(0.5, float(os.environ.get('CODEGUARD_GITHUB_POLL_SECONDS', DEFAULT_POLL_SECONDS)))
    except (TypeError, ValueError):
        return DEFAULT_POLL_SECONDS


def _headers():
    return {
        'Authorization': f'Bearer {token()}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'CodeGuard',
    }


def _repo_url(suffix):
    return f'{API_ROOT}/repos/{repository()}{suffix}'


def _check(response, what):
    if response.status_code == 200:
        return response
    detail = f'HTTP {response.status_code}'
    if response.status_code in (401, 403):
        detail += ' (token missing, expired or lacking the `repo` scope)'
    elif response.status_code == 404:
        detail += ' (repository not found or token has no access)'
    raise GitHubActionsError(f'Could not {what}: {detail}')


def dispatch(scan_id, archive_url, args):
    """
    Queue the workflow for one scan.  Raises :class:`GitHubActionsError`.
    """
    payload = {
        'ref': ref(),
        'inputs': {
            'scan_id': scan_id,
            'archive_url': archive_url,
            'args': args,
        },
    }
    try:
        response = requests.post(
            _repo_url(f'/actions/workflows/{workflow_file()}/dispatches'),
            json=payload,
            headers=_headers(),
            timeout=DEFAULT_HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise GitHubActionsError(f'Could not reach GitHub to queue the scan: {exc}') from exc

    if response.status_code == 204:
        return

    detail = f'HTTP {response.status_code}'
    if response.status_code == 404:
        detail += (
            f' (workflow {workflow_file()} not found in {repository()} — '
            'it must be pushed to the default branch)'
        )
    elif response.status_code == 422:
        detail += f' {response.text[:300]}'
    raise GitHubActionsError(f'Could not queue the Semgrep workflow: {detail}')


def _parse_created(run):
    raw = run.get('created_at') or ''
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        return None


def _find_run(scan_id):
    """
    Return the dispatched run belonging to ``scan_id``, or None.

    Runs titled with the scan id (the workflow sets ``run-name``) win over
    merely recent runs, so a hand-triggered run never hijacks the poll.
    """
    response = requests.get(
        _repo_url(f'/actions/workflows/{workflow_file()}/runs'),
        params={'event': 'workflow_dispatch', 'per_page': 10},
        headers=_headers(),
        timeout=DEFAULT_HTTP_TIMEOUT,
    )
    _check(response, 'list workflow runs')
    runs = response.json().get('workflow_runs') or []

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=RUN_MATCH_SKEW_SECONDS)
    tagged = []
    recent = []
    for run in runs:
        created = _parse_created(run)
        if created is None or created < cutoff:
            continue
        title = f"{run.get('name') or ''} {run.get('display_title') or ''}"
        if scan_id and scan_id in title:
            tagged.append(run)
        else:
            recent.append(run)
    candidates = tagged or recent
    return candidates[0] if candidates else None


def wait_for_result(scan_id, timeout_seconds):
    """
    Wait for the dispatched run to finish and return its result payload::

        {'stdout': str, 'stderr': str, 'exit_code': int|None, 'run_url': str}

    Raises :class:`GitHubActionsError` on timeout, a failed run or a
    missing artifact — the caller decides whether to fall back to a local
    Semgrep.
    """
    deadline = time.monotonic() + max(30.0, float(timeout_seconds))
    run_id = None

    while True:
        if run_id is None:
            found = _find_run(scan_id)
            if found is not None:
                run_id = found.get('id')

        run = None
        if run_id is not None:
            response = requests.get(
                _repo_url(f'/actions/runs/{run_id}'),
                headers=_headers(),
                timeout=DEFAULT_HTTP_TIMEOUT,
            )
            _check(response, f'fetch run {run_id}')
            run = response.json()
            if run.get('status') == 'completed':
                break

        if time.monotonic() >= deadline:
            raise GitHubActionsError(
                f'Timed out after {int(timeout_seconds)}s waiting for the Semgrep '
                f'run on GitHub Actions (scan {scan_id}). It may still be queued — '
                'check the Actions tab of the target repository.'
            )
        time.sleep(poll_interval())

    run_url = run.get('html_url') or ''
    conclusion = run.get('conclusion') or ''
    if conclusion != 'success':
        raise GitHubActionsError(
            f'Semgrep run on GitHub Actions {conclusion or "did not succeed"}: {run_url}'
        )

    return _download_result(run, run_url)


def _wait_for_artifact(run, run_url):
    """Return the run's Semgrep artifact, tolerating a short publish lag."""
    deadline = time.monotonic() + ARTIFACT_RETRY_ATTEMPTS * ARTIFACT_RETRY_SECONDS
    while True:
        response = requests.get(
            _repo_url(f"/actions/runs/{run.get('id')}/artifacts"),
            headers=_headers(),
            timeout=DEFAULT_HTTP_TIMEOUT,
        )
        _check(response, 'list run artifacts')

        artifacts = [
            item for item in response.json().get('artifacts') or []
            if item.get('name') == ARTIFACT_NAME and not item.get('expired')
        ]
        if artifacts:
            return artifacts[0]

        if time.monotonic() >= deadline:
            raise GitHubActionsError(
                f'Semgrep run finished but produced no {ARTIFACT_NAME} artifact: {run_url}'
            )
        time.sleep(ARTIFACT_RETRY_SECONDS)


def _download_result(run, run_url):
    artifact = _wait_for_artifact(run, run_url)

    try:
        download = requests.get(
            artifact['archive_download_url'],
            headers=_headers(),
            timeout=DEFAULT_HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise GitHubActionsError(f'Could not download the Semgrep result: {exc}') from exc
    if download.status_code != 200:
        raise GitHubActionsError(
            f'Could not download the Semgrep result: HTTP {download.status_code} ({run_url})'
        )

    try:
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            def read(name):
                try:
                    return archive.read(name).decode('utf-8', errors='replace')
                except KeyError:
                    return ''

            stdout = read(STDOUT_FILE)
            stderr = read(STDERR_FILE)
            rc_text = read(EXIT_CODE_FILE).strip()
    except zipfile.BadZipFile as exc:
        raise GitHubActionsError(f'Unreadable Semgrep result artifact: {exc}') from exc

    if not stdout.strip():
        # Never hand empty output to the parser: it would downgrade a broken
        # workflow to "no findings" or an opaque fallback.
        raise GitHubActionsError(
            f'The {ARTIFACT_NAME} artifact has no {STDOUT_FILE} ({run_url}) — the '
            'workflow and the worker disagree about the file it writes.'
        )

    try:
        exit_code = int(rc_text) if rc_text else None
    except ValueError:
        exit_code = None

    return {
        'stdout': stdout,
        'stderr': stderr,
        'exit_code': exit_code,
        'run_url': run_url,
    }


__all__ = [
    'ARTIFACT_NAME',
    'GitHubActionsError',
    'dispatch',
    'enabled',
    'poll_interval',
    'public_api_base',
    'repository',
    'token',
    'wait_for_result',
    'workflow_file',
]
