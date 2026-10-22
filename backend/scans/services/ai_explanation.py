"""
Turn a scanner finding into a structured, developer-friendly explanation.

The service is deliberately conservative:

* only the selected finding and a small window of the affected source file
  are sent to the provider — never the whole uploaded project;
* the model is asked for a strict JSON document, and the answer is validated
  before it reaches the frontend.  A malformed answer degrades to plain text
  instead of being silently dropped;
* the model is explicitly told not to invent code, not to claim the project
  was modified and not to claim the finding is fixed.
"""
import json
import logging
import re

from django.utils import timezone

from .ai_provider import AIInvalidResponseError, get_ai_provider

logger = logging.getLogger('scans.ai')

SYSTEM_PROMPT = """You are a senior application security engineer explaining a single \
static-analysis finding to a developer who opened CodeGuard.

Rules you must follow:
1. Only use the information provided about the finding and the code excerpt. \
Never invent source code, file names, line numbers or advisories that were not provided.
2. The example code you show is ILLUSTRATIVE. Never state or imply that it was tested, \
applied to the project, or that the vulnerability has been fixed.
3. Do not claim that you changed, patched or can change the uploaded project.
4. Be factual about risk: describe realistic consequences and the conditions under \
which the issue is exploitable. Do not exaggerate.
5. If the code excerpt is missing, explain the issue from the scanner metadata alone \
and say that the source snippet was not available.
6. Match the language and framework of the affected file.

Respond with a single JSON object and nothing else. Use exactly these keys:
{
  "summary": "one sentence describing the issue",
  "what_it_means": "plain-language explanation of the insecure behaviour (markdown allowed)",
  "why_it_matters": "realistic security consequences and exploitability conditions (markdown allowed)",
  "where_it_occurs": "the affected file, line and code behaviour (markdown allowed)",
  "how_to_fix": ["ordered remediation step", "..."],
  "safer_example": {
    "language": "the language of the example, e.g. javascript",
    "code": "a concise safer implementation",
    "note": "one sentence explaining what changed"
  },
  "additional_recommendations": ["defensive practice, validation, config or regression test"],
  "references": [{"title": "reference title", "url": "https://..."}]
}
Use empty strings or empty lists for anything you cannot support with the given data."""

_JSON_KEYS = (
    'summary', 'what_it_means', 'why_it_matters', 'where_it_occurs',
    'how_to_fix', 'safer_example', 'additional_recommendations', 'references',
)

_FENCE_RE = re.compile(r'```(?:json)?\s*(.*?)\s*```', re.DOTALL)


# ── Prompt construction ───────────────────────────────────────────────────────

def _location_line(finding):
    file_path = finding.get('file') or 'unknown file'
    line = finding.get('line')
    end_line = finding.get('end_line')
    if line and end_line and end_line != line:
        return f'{file_path} (lines {line}-{end_line})'
    if line:
        return f'{file_path} (line {line})'
    return file_path


def build_prompt(finding, source_context=None):
    """Build the ``(system, user)`` prompt pair for one finding."""
    details = [
        f'Scanner: {finding.get("scanner") or "unknown"}',
        f'Rule: {finding.get("rule_id") or finding.get("title") or "n/a"}',
        f'Title: {finding.get("title") or "n/a"}',
        f'Severity: {finding.get("severity") or "unknown"}',
        f'Location: {_location_line(finding)}',
    ]
    if finding.get('cwe'):
        details.append(f'CWE: {finding["cwe"]}')
    if finding.get('owasp'):
        details.append(f'OWASP: {finding["owasp"]}')
    if finding.get('language'):
        details.append(f'Language: {finding["language"]}')
    if finding.get('description'):
        details.append(f'Scanner description: {finding["description"]}')
    if finding.get('remediation'):
        details.append(f'Scanner remediation hint: {finding["remediation"]}')

    prompt = ['FINDING', *details]

    scanner_snippet = (finding.get('code_snippet') or '').strip()
    if scanner_snippet:
        prompt += ['', 'CODE EXCERPT REPORTED BY THE SCANNER', scanner_snippet]

    if source_context and source_context.get('code'):
        start = source_context.get('start_line')
        end = source_context.get('end_line')
        label = f'{source_context.get("path")}'
        if start and end:
            label += f' (lines {start}-{end})'
        prompt += [
            '',
            f'SOURCE CONTEXT FROM THE UPLOADED PROJECT — {label}',
            '```',
            source_context['code'],
            '```',
        ]
    else:
        prompt += [
            '',
            'SOURCE CONTEXT: not available. Explain the issue using the scanner '
            'metadata only and state that the source snippet was unavailable.',
        ]

    prompt += [
        '',
        'Write the explanation now, as the JSON object described in the system prompt.',
    ]

    return SYSTEM_PROMPT, '\n'.join(prompt)


# ── Response parsing ──────────────────────────────────────────────────────────

def _extract_json_payload(raw_text):
    """Try hard to turn the model output into a JSON object."""
    if not raw_text:
        return None

    text = str(raw_text).strip()

    # 1. Plain JSON.
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except ValueError:
        pass

    # 2. JSON wrapped in a markdown code fence.
    match = _FENCE_RE.search(text)
    if match:
        try:
            data = json.loads(match.group(1))
            if isinstance(data, dict):
                return data
        except ValueError:
            pass

    # 3. The first balanced JSON object in the text.
    start = text.find('{')
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    candidate = text[start:index + 1]
                    try:
                        data = json.loads(candidate)
                        if isinstance(data, dict):
                            return data
                    except ValueError:
                        break
        start = text.find('{', start + 1)

    return None


def _as_text(value):
    if value is None:
        return ''
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        return '\n'.join(_as_text(item) for item in value).strip()
    if isinstance(value, dict):
        return '\n'.join(f'- {key}: {item}' for key, item in value.items()).strip()
    return str(value).strip()


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (list, tuple)):
        items = []
        for item in value:
            text = _as_text(item)
            if text:
                items.append(text)
        return items
    text = _as_text(value)
    return [text] if text else []


def _as_references(value):
    """
    Normalise the ``references`` field.

    The field is accepted in the shapes models actually produce: a list of
    ``{"title": ..., "url": ...}`` objects, a list of URLs, or a list of
    strings that embed the URL.
    """
    references = []
    if value is None:
        return references

    items = value if isinstance(value, (list, tuple)) else [value]

    for item in items:
        if isinstance(item, dict):
            url = str(item.get('url') or '').strip()
            title = str(item.get('title') or '').strip()
            if url:
                references.append({'title': title or url, 'url': url})
            continue

        if not isinstance(item, str):
            continue

        text = item.strip()
        if not text:
            continue

        match = re.search(r'https?://\S+', text)
        if match:
            url = match.group(0)
            title = text.replace(url, '').strip(' -—:;,')
            references.append({'title': title or url, 'url': url})
        elif text.startswith('http'):
            references.append({'title': text, 'url': text})

    return references


def normalize_explanation(raw_text):
    """
    Validate the provider output and return the canonical explanation payload.

    The canonical shape is::

        {
            'format': 'structured' | 'text',
            'summary': str,
            'what_it_means': str,
            'why_it_matters': str,
            'where_it_occurs': str,
            'how_to_fix': [str],
            'safer_example': {'language': str, 'code': str, 'note': str},
            'additional_recommendations': [str],
            'references': [{'title': str, 'url': str}],
            'raw_markdown': str,
        }

    A response that is not valid JSON is not discarded — it is returned as
    ``format='text'`` with the original markdown so the user still sees the
    explanation.
    """
    payload = _extract_json_payload(raw_text)

    if payload is None:
        text = (raw_text or '').strip()
        if not text:
            raise AIInvalidResponseError('The AI provider returned an empty response.')
        return {
            'format': 'text',
            'summary': '',
            'what_it_means': '',
            'why_it_matters': '',
            'where_it_occurs': '',
            'how_to_fix': [],
            'safer_example': {'language': '', 'code': '', 'note': ''},
            'additional_recommendations': [],
            'references': [],
            'raw_markdown': text,
        }

    # Some providers wrap the payload in an extra object.
    if not any(key in payload for key in _JSON_KEYS):
        for value in payload.values():
            if isinstance(value, dict) and any(key in value for key in _JSON_KEYS):
                payload = value
                break

    example = payload.get('safer_example')
    if isinstance(example, str):
        example = {'language': '', 'code': example, 'note': ''}
    elif not isinstance(example, dict):
        example = {}

    normalized = {
        'format': 'structured',
        'summary': _as_text(payload.get('summary')),
        'what_it_means': _as_text(payload.get('what_it_means')),
        'why_it_matters': _as_text(payload.get('why_it_matters')),
        'where_it_occurs': _as_text(payload.get('where_it_occurs')),
        'how_to_fix': _as_list(payload.get('how_to_fix')),
        'safer_example': {
            'language': _as_text(example.get('language')),
            'code': _as_text(example.get('code')),
            'note': _as_text(example.get('note')),
        },
        'additional_recommendations': _as_list(payload.get('additional_recommendations')),
        'references': _as_references(payload.get('references')),
        'raw_markdown': '',
    }

    # Nothing usable came back — keep the raw text so the content is not lost.
    if not any(
        normalized[key]
        for key in ('summary', 'what_it_means', 'why_it_matters', 'where_it_occurs',
                    'how_to_fix', 'additional_recommendations')
    ) and not normalized['safer_example']['code']:
        raw = _as_text(payload)
        if raw:
            normalized['format'] = 'text'
            normalized['raw_markdown'] = raw

    return normalized


# ── Entry point ───────────────────────────────────────────────────────────────

def generate_explanation(finding, source_context=None):
    """
    Ask the configured AI provider to explain ``finding``.

    Returns ``(explanation, provider_name, model)``.  Provider failures raise an
    :class:`~scans.services.ai_provider.AIProviderError` subclass which the
    view translates into an HTTP response.
    """
    provider = get_ai_provider()
    system_prompt, user_prompt = build_prompt(finding, source_context)

    raw_text = provider.complete(system_prompt, user_prompt)
    explanation = normalize_explanation(raw_text)

    explanation['model'] = provider.model
    explanation['provider'] = provider.name
    explanation['generated_at'] = timezone.now().isoformat()

    return explanation
