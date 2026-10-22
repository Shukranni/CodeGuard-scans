"""
End-to-end provider error matrix against a *running* server.

The Django server must be started with ``OPENAI_API_KEY`` and
``OPENAI_BASE_URL`` pointing at the fake OpenAI server, so that the real HTTP
call is made and the real error mapping is exercised:

    python scripts/fake_openai_server.py 8899
    $env:OPENAI_API_KEY='sk-local-fake'; $env:OPENAI_BASE_URL='http://127.0.0.1:8899/v1'
    python manage.py runserver 127.0.0.1:8001 --noreload
    python scripts/live_provider_matrix.py

Usage:
    python scripts/live_provider_matrix.py
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
from rest_framework_simplejwt.tokens import RefreshToken  # noqa: E402

from scans.models import Scan  # noqa: E402
from scans.services.findings import normalize_scan_findings  # noqa: E402

API_BASE = os.environ.get('CODEGUARD_AI_BASE_URL', 'http://127.0.0.1:8001').rstrip('/')
FAKE_BASE = os.environ.get('CODEGUARD_FAKE_PROVIDER_URL', 'http://127.0.0.1:8899').rstrip('/')
USER_ID = int(os.environ.get('CODEGUARD_AI_USER_ID', '2'))

FAILURES = []


def check(name, condition, detail=''):
    if condition:
        print(f'  ok   {name}')
    else:
        FAILURES.append(name)
        print(f'  FAIL {name}' + (f' — {detail}' if detail else ''))


def call(url, method='GET', token=None, body=None):
    headers = {'Accept': 'application/json'}
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read().decode('utf-8')
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode('utf-8')
        try:
            return error.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return error.code, raw


def set_mode(mode):
    call(f'{FAKE_BASE}/__mode__/{mode}', method='POST', body={})


def main():
    user = User.objects.filter(id=USER_ID).first()
    token = str(RefreshToken.for_user(user).access_token)

    scan = Scan.objects.filter(project__owner_id=USER_ID).exclude(result={}).order_by('-id').first()
    findings = normalize_scan_findings(scan)
    finding_id = findings[0]['id']
    url = f'{API_BASE}/api/scans/{scan.id}/findings/{finding_id}/explain/'

    print(f'\nScan #{scan.id} · finding {finding_id}\n')

    print('Structured answer')
    set_mode('structured')
    status, payload = call(url, method='POST', token=token, body={'finding_id': finding_id})
    check('the request succeeds', status == 200, f'status={status} payload={payload}')
    explanation = (payload or {}).get('explanation') or {}
    check('the answer is structured', explanation.get('format') == 'structured')
    check('every section is present', all(
        key in explanation for key in (
            'summary', 'what_it_means', 'why_it_matters', 'where_it_occurs',
            'how_to_fix', 'safer_example', 'additional_recommendations', 'references',
        )
    ), json.dumps(explanation)[:300])
    check('the provider and model are reported',
          explanation.get('provider') == 'openai' and bool(explanation.get('model')),
          json.dumps({k: explanation.get(k) for k in ('provider', 'model')}))
    check('a generation timestamp is reported', bool(explanation.get('generated_at')))
    check('the references keep their urls',
          all(r.get('url', '').startswith('http') for r in explanation.get('references') or []))

    print('\nPlain-text answer (non JSON provider output)')
    set_mode('text')
    status, payload = call(url, method='POST', token=token, body={'finding_id': finding_id})
    check('the request still succeeds', status == 200, f'status={status}')
    explanation = (payload or {}).get('explanation') or {}
    check('the answer degrades to text', explanation.get('format') == 'text')
    check('the raw markdown is preserved', 'child_process' in (explanation.get('raw_markdown') or ''))

    print('\nUnusable provider output')
    set_mode('garbage')
    status, payload = call(url, method='POST', token=token, body={'finding_id': finding_id})
    check('the request still succeeds', status == 200, f'status={status}')
    explanation = (payload or {}).get('explanation') or {}
    check('the answer degrades to text', explanation.get('format') == 'text')

    print('\nProvider rejects the credentials')
    set_mode('401')
    status, payload = call(url, method='POST', token=token, body={'finding_id': finding_id})
    check('the request fails with 502', status == 502, f'status={status} payload={payload}')
    check('the code is "ai_invalid_credentials"',
          (payload or {}).get('code') == 'ai_invalid_credentials', json.dumps(payload)[:300])
    check('the error is not retryable', (payload or {}).get('retryable') is False)
    check('the error has no stack trace', 'Traceback' not in json.dumps(payload))

    print('\nProvider rate limits the request')
    set_mode('429')
    status, payload = call(url, method='POST', token=token, body={'finding_id': finding_id})
    check('the request fails with 429', status == 429, f'status={status} payload={payload}')
    check('the code is "ai_rate_limited"', (payload or {}).get('code') == 'ai_rate_limited')
    check('the error is retryable', (payload or {}).get('retryable') is True)
    check('the retry delay is forwarded', (payload or {}).get('retry_after') == 12,
          json.dumps(payload)[:300])

    print('\nProvider is down')
    set_mode('500')
    status, payload = call(url, method='POST', token=token, body={'finding_id': finding_id})
    check('the request fails with 503', status == 503, f'status={status} payload={payload}')
    check('the code is "ai_unavailable"', (payload or {}).get('code') == 'ai_unavailable')
    check('the error is retryable', (payload or {}).get('retryable') is True)

    set_mode('structured')
    print(f'\n{"FAILURES: " + ", ".join(FAILURES) if FAILURES else "All provider-matrix checks passed"}\n')
    return 1 if FAILURES else 0


if __name__ == '__main__':
    sys.exit(main())
