"""
Dump the live payloads of the AI explanation endpoints for documentation.

Usage:
    python scripts/dump_live_payloads.py [output.json]
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

BASE_URL = os.environ.get('CODEGUARD_AI_BASE_URL', 'http://127.0.0.1:8001').rstrip('/')
USER_ID = int(os.environ.get('CODEGUARD_AI_USER_ID', '2'))
OUT = sys.argv[1] if len(sys.argv) > 1 else None


def call(path, method='GET', token=None, body=None):
    headers = {'Accept': 'application/json'}
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(f'{BASE_URL}{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        raw = error.read().decode('utf-8')
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw


def main():
    user = User.objects.filter(id=USER_ID).first()
    token = str(RefreshToken.for_user(user).access_token)
    scan = Scan.objects.filter(project__owner_id=USER_ID).exclude(result={}).order_by('-id').first()
    finding_id = normalize_scan_findings(scan)[0]['id']

    detail_status, detail = call(f'/api/scans/{scan.id}/findings/{finding_id}/', token=token)
    explain_status, explain = call(
        f'/api/scans/{scan.id}/findings/{finding_id}/explain/',
        method='POST', token=token, body={'finding_id': finding_id},
    )

    payload = {
        'GET /api/scans/{scan}/findings/{finding}/': {'status': detail_status, 'body': detail},
        'POST /api/scans/{scan}/findings/{finding}/explain/': {'status': explain_status, 'body': explain},
    }

    if OUT:
        with open(OUT, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, indent=2)
        print(f'written to {OUT}')
    else:
        print(json.dumps(payload, indent=2))

    return 0


if __name__ == '__main__':
    sys.exit(main())
