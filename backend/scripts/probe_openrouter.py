"""Find out why the real provider answer comes back empty."""
import json
import os
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

import django  # noqa: E402

django.setup()

from scans.models import Scan  # noqa: E402
from scans.services.ai_explanation import build_prompt  # noqa: E402
from scans.services.findings import normalize_scan_findings  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

key = os.environ['OPENROUTER_API_KEY']
model = os.environ.get('OPENROUTER_MODEL', 'minimax/minimax-m3.1-flash:free')

scan = Scan.objects.filter(project__owner_id=2).exclude(result={}).order_by('-id').first()
finding = normalize_scan_findings(scan)[0]
system_prompt, user_prompt = build_prompt(finding, None)

print(f'model: {model}')
print(f'prompt chars: system={len(system_prompt)} user={len(user_prompt)}')
print('-' * 70)

for max_tokens in (1600, 4000):
    response = requests.post(
        'https://openrouter.ai/api/v1/chat/completions',
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        json={
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'temperature': 0.2,
            'max_tokens': max_tokens,
        },
        timeout=300,
    )
    payload = response.json()
    choice = payload['choices'][0]
    message = choice['message']
    print(f'max_tokens={max_tokens}  status={response.status_code}  '
          f'finish_reason={choice.get("finish_reason")}  '
          f'content_len={len(message.get("content") or "")}  '
          f'reasoning_len={len(message.get("reasoning") or "")}  '
          f'usage={json.dumps(payload.get("usage", {}).get("completion_tokens_details"))}')
    print('  content head:', repr((message.get('content') or '')[:160]))
    print('-' * 70)
