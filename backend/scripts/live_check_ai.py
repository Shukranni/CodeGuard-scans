"""
Live end-to-end check for the AI explanation endpoints.

Runs against a *running* Django server (not the test client), so it proves the
real HTTP contract: status codes, JSON shapes, ownership enforcement and the
error payload when no AI provider is configured.

Usage:
    python manage.py runserver 127.0.0.1:8000 --noreload     # in another shell
    python scripts/live_check_ai.py                          # in backend/

Environment:
    CODEGUARD_AI_BASE_URL   default http://127.0.0.1:8000
    CODEGUARD_AI_USER_ID    default 2
"""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

import django  # noqa: E402

django.setup()

from django.contrib.auth.models import User  # noqa: E402
from django.db.models import Q  # noqa: E402
from rest_framework_simplejwt.tokens import RefreshToken  # noqa: E402

from scans.models import Scan  # noqa: E402

BASE_URL = os.environ.get('CODEGUARD_AI_BASE_URL', 'http://127.0.0.1:8000').rstrip('/')
USER_ID = int(os.environ.get('CODEGUARD_AI_USER_ID', '2'))

FAILURES = []


def check(name, condition, detail=''):
    if condition:
        print(f'  ok   {name}')
    else:
        FAILURES.append(name)
        print(f'  FAIL {name}' + (f' — {detail}' if detail else ''))


def request(path, method='GET', token=None, body=None):
    url = f'{BASE_URL}{path}'
    data = None
    headers = {'Accept': 'application/json'}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            raw = response.read().decode('utf-8')
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode('utf-8')
        try:
            payload = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            payload = raw
        return error.code, payload


def pick_scan():
    """A scan owned by the test user that actually has findings."""
    scans = (
        Scan.objects.filter(project__owner_id=USER_ID)
        .exclude(result={})
        .order_by('-id')
    )
    for scan in scans:
        if scan.result:
            return scan
    return scans.first()


def finding_ids(scan):
    """Use the same normalisation the API uses to build finding ids."""
    from scans.services.findings import normalize_scan_findings

    return [f['id'] for f in normalize_scan_findings(scan)]


def main():
    user = User.objects.filter(id=USER_ID).first()
    if not user:
        print(f'User {USER_ID} does not exist — set CODEGUARD_AI_USER_ID.')
        return 1

    token = str(RefreshToken.for_user(user).access_token)

    scan = pick_scan()
    if not scan:
        print('No scan with results found for this user.')
        return 1

    ids = finding_ids(scan)
    print(f'\nUser #{user.id} ({user.username}) · scan #{scan.id} · {len(ids)} findings\n')
    if not ids:
        print('The scan has no normalisable findings.')
        return 1

    finding_id = ids[0]

    print('Unauthenticated access')
    status, payload = request(f'/api/scans/{scan.id}/findings/{finding_id}/')
    check('an anonymous request is rejected', status == 401, f'status={status}')

    print('\nFinding detail')
    status, payload = request(f'/api/scans/{scan.id}/findings/{finding_id}/', token=token)
    check('the detail endpoint answers 200', status == 200, f'status={status} payload={payload}')
    if status == 200:
        check('the payload has the finding', isinstance(payload.get('finding'), dict))
        check('the payload has the source context', 'source_context' in payload)
        check('the payload has the scan', 'scan' in payload)
        check(
            'the finding id matches the request',
            payload.get('finding', {}).get('id') == finding_id,
            payload.get('finding', {}).get('id'),
        )
        check(
            'the finding carries a real title',
            bool(str(payload.get('finding', {}).get('title') or '').strip()),
        )
        check(
            'the source context is bounded',
            len(payload.get('source_context') or {}) >= 0
            and len(str((payload.get('source_context') or {}).get('code') or '')) <= 4000,
        )

    print('\nOwnership enforcement')
    # Projects with owner_id = NULL are owned by nobody, so they are foreign
    # for every authenticated user — they must not be readable either.
    foreign_scans = (
        Scan.objects.filter(Q(project__owner_id__isnull=True) | ~Q(project__owner_id=USER_ID))
        .exclude(result={})
        .order_by('-id')
    )
    foreign = None
    foreign_ids = []
    for candidate in foreign_scans:
        candidate_ids = finding_ids(candidate)
        if candidate_ids:
            foreign = candidate
            foreign_ids = candidate_ids
            break

    if foreign:
        status, payload = request(
            f'/api/scans/{foreign.id}/findings/{foreign_ids[0]}/', token=token
        )
        check(
            "another user's finding is not readable",
            status == 404,
            f'status={status} payload={payload}',
        )
        status, payload = request(
            f'/api/scans/{foreign.id}/findings/{foreign_ids[0]}/explain/',
            method='POST',
            token=token,
            body={},
        )
        check(
            "another user's finding cannot be explained",
            status == 404,
            f'status={status} payload={payload}',
        )
    else:
        print('  skip   no foreign findings to probe')

    print('\nAI explanation')
    status, payload = request(
        f'/api/scans/{scan.id}/findings/{finding_id}/explain/',
        method='POST',
        token=token,
        body={'finding_id': finding_id},
    )
    check(
        'the explain endpoint answers with a machine readable status',
        status in (200, 503),
        f'status={status} payload={payload}',
    )
    if status == 503:
        check(
            'a missing provider reports "ai_not_configured"',
            payload.get('code') == 'ai_not_configured',
            json.dumps(payload)[:300],
        )
        check(
            'the error payload has no stack trace',
            'Traceback' not in json.dumps(payload),
        )
        check('the error message is actionable', bool(str(payload.get('error') or '').strip()))
    elif status == 200:
        explanation = payload.get('explanation') or {}
        check('the explanation is structured', explanation.get('format') in ('structured', 'text'))
        check('the explanation has a summary', bool(str(explanation.get('summary') or '').strip()))
        check('the payload repeats the finding', 'finding' in payload)
        check('the payload includes the source context', 'source_context' in payload)

    print('\nUnknown finding')
    status, payload = request(
        f'/api/scans/{scan.id}/findings/definitely_not_a_finding/', token=token
    )
    check('an unknown finding answers 404', status == 404, f'status={status} payload={payload}')

    print('\nCredential isolation')
    secret = (
        os.environ.get('OPENROUTER_API_KEY')
        or os.environ.get('OPENAI_API_KEY')
        or os.environ.get('ANTHROPIC_API_KEY')
        or ''
    )
    if secret:
        status, payload = request(
            f'/api/scans/{scan.id}/findings/{finding_id}/explain/',
            method='POST',
            token=token,
            body={'finding_id': finding_id},
        )
        body = json.dumps(payload)
        check('the provider API key never reaches the response', secret not in body)
        check(
            'the response does not contain an Authorization header echo',
            'Bearer' not in body,
        )
    else:
        print('  skip   no provider key in the environment')

    print(
        f'\n{"FAILURES: " + ", ".join(FAILURES) if FAILURES else "All live checks passed"}\n'
    )
    return 1 if FAILURES else 0


if __name__ == '__main__':
    sys.exit(main())
