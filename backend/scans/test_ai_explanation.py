"""
Tests for the AI explanation endpoints.

Covered:
  * owner isolation (404 for foreign scans, 401 when unauthenticated),
  * the finding is always resolved from the stored scan result — the client
    cannot inject the content of an explanation,
  * the real finding data and the real source window are returned,
  * a Gitleaks secret is masked and never leaves the backend,
  * provider failures are mapped onto predictable, actionable HTTP errors
    (missing configuration, invalid credentials, insufficient credits, an
    unavailable model, rate limit, timeout, unavailable provider, an answer
    cut short by the token limit, unusable answer),
  * the OpenRouter gateway is supported as a first-class provider,
  * only the finding and a small window of the affected file reach the
    provider — never the whole uploaded project,
  * a non-JSON answer degrades to plain text instead of being dropped.
"""
import json
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from rest_framework import status as http_status
from rest_framework.test import APITestCase

from .models import Scan
from .tests import AuthMixin, ScanTestEnvironment, make_zip_bytes

# ── Fixtures ─────────────────────────────────────────────────────────────────

SOURCE_FILE = 'src/pages/dashboard/index.jsx'
UNRELATED_MARKER = 'UNRELATED_PROJECT_FILE_MARKER'

PROJECT_FILES = {
    SOURCE_FILE: '\n'.join(
        [
            'import React from "react";',
            '',
            'export default function Dashboard() {',
            '  const [name, setName] = React.useState("");',
            '',
            '  // ...',
            '',
            '  return (',
            '    <div>',
            '      <h1>Dashboard</h1>',
            '    </div>',
            '  );',
            '}',
        ]
    ),
    'src/other/secret-file.js': f'// {UNRELATED_MARKER}\nexport const other = 1;\n',
}

SEMGREP_RAW = {
    'check_id': 'javascript.express.security.audit.xss.direct-response-write',
    'path': SOURCE_FILE,
    'start': {'line': 5, 'col': 1},
    'end': {'line': 6, 'col': 1},
    'extra': {
        'severity': 'ERROR',
        'message': 'Direct response write of user input. XSS vulnerability.',
        'lines': 'const html = req.query.name;',
        'metadata': {
            'cwe': ['CWE-79'],
            'owasp': ['A03:2021 - Injection'],
            'remediation': 'Escape the value before writing it to the response.',
        },
    },
}

SEMGREP_PLACEHOLDER_RAW = {
    'check_id': 'python.django.security.audit.form-render',
    'path': 'app/forms.py',
    'start': {'line': 12},
    'end': {'line': 12},
    'extra': {
        'severity': 'WARNING',
        'message': 'Form rendering without autoescape.',
        'lines': 'requires login',
        'metadata': {'cwe': ['CWE-79']},
    },
}

GITLEAKS_RAW = {
    'RuleID': 'generic-api-key',
    'Description': 'Generic API Key',
    'StartLine': 4,
    'EndLine': 4,
    'Match': 'api_key = "sk-live-SUPERSECRET123"',
    'Secret': 'sk-live-SUPERSECRET123',
    'File': 'config/settings.py',
}

DEPENDENCY_RAW = {
    'severity': 'high',
    'range': '<7.0.0',
    'via': [
        {
            'title': 'Remote code execution',
            'url': 'https://example.test/advisory/1',
            'severity': 'high',
            'cwe': ['CWE-94'],
            'cvss': {'score': 9.8},
        },
    ],
    'fixAvailable': True,
}

SCAN_RESULT = {
    'validation': {'isValid': True},
    'scans': {
        'semgrep': {
            'all_vulnerabilities': [SEMGREP_RAW, SEMGREP_PLACEHOLDER_RAW],
            'summary': '2 issues',
        },
        'gitleaks': {'all_vulnerabilities': [GITLEAKS_RAW]},
        'dependency': {'all_vulnerabilities': {'@babel/core': DEPENDENCY_RAW}},
    },
}

AI_JSON_ANSWER = {
    'summary': 'User input is written into the response without escaping.',
    'what_it_means': 'The value of `req.query.name` ends up in the HTML output.',
    'why_it_matters': 'An attacker can inject markup and script into the page.',
    'where_it_occurs': f'{SOURCE_FILE} (lines 5-6)',
    'how_to_fix': ['Escape the value', 'Use a template engine'],
    'safer_example': {
        'language': 'javascript',
        'code': 'const html = escapeHtml(req.query.name);',
        'note': 'The value is escaped before it is written to the response.',
    },
    'additional_recommendations': ['Add a Content-Security-Policy header'],
    'references': [{'title': 'OWASP XSS', 'url': 'https://owasp.org/www-community/attacks/xss/'}],
}


def fake_response(status_code=200, payload=None, headers=None, json_error=None):
    response = mock.Mock()
    response.status_code = status_code
    response.headers = headers or {}
    if json_error is not None:
        response.json.side_effect = json_error
    else:
        response.json.return_value = payload
    return response


def openai_response(content):
    return fake_response(payload={'choices': [{'message': {'content': content}}]})


def openai_stream_response(text):
    response = fake_response()
    response.iter_lines.return_value = [
        b'data: {"choices":[{"delta":{"content":' + json.dumps(text).encode('utf-8') + b'},"finish_reason":null}]}',
        b'',
        b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        b'',
        b'data: [DONE]',
    ]
    response.close = mock.Mock()
    return response


# ─────────────────────────────────────────────────────────────────────────────
# Shared base
# ─────────────────────────────────────────────────────────────────────────────

class ExplanationTestBase(ScanTestEnvironment, AuthMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user()
        self.login(self.user)
        self.project = self.make_project(
            self.user,
            zip_bytes=make_zip_bytes(PROJECT_FILES),
        )
        self.scan = Scan.objects.create(
            project=self.project,
            scanners=['semgrep', 'gitleaks', 'dependency'],
            status='completed',
            stage='done',
            progress=100,
            started_at=timezone.now(),
            completed_at=timezone.now(),
            result=SCAN_RESULT,
        )

    def detail_url(self, finding_id):
        return f'/api/scans/{self.scan.pk}/findings/{finding_id}/'

    def explain_url(self, finding_id):
        return f'/api/scans/{self.scan.pk}/findings/{finding_id}/explain/'

    def explain(self, finding_id, body=None):
        payload = {'finding_id': finding_id}
        if body is not None:
            payload.update(body)
        return self.client.post(self.explain_url(finding_id), payload, format='json')


# ─────────────────────────────────────────────────────────────────────────────
# GET — the authoritative finding data
# ─────────────────────────────────────────────────────────────────────────────

class FindingDetailEndpointTests(ExplanationTestBase):
    def test_unauthenticated_is_rejected(self):
        self.client.credentials()
        res = self.client.get(self.detail_url('semgrep_0'))
        self.assertEqual(res.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_foreign_scan_returns_404(self):
        intruder = self.make_user()
        self.login(intruder)
        res = self.client.get(self.detail_url('semgrep_0'))
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_owner_receives_the_stored_finding(self):
        res = self.client.get(self.detail_url('semgrep_0'))
        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)

        finding = res.data['finding']
        self.assertEqual(finding['id'], 'semgrep_0')
        self.assertEqual(finding['scanner'], 'Semgrep')
        self.assertEqual(finding['severity'], 'critical')
        self.assertEqual(finding['file'], SOURCE_FILE)
        self.assertEqual(finding['line'], 5)
        self.assertEqual(finding['end_line'], 6)
        self.assertEqual(finding['cwe'], 'CWE-79')
        self.assertEqual(finding['owasp'], 'A03:2021 - Injection')
        self.assertEqual(finding['rule_id'], SEMGREP_RAW['check_id'])
        # The scan the finding belongs to is part of the answer.
        self.assertEqual(res.data['scan']['id'], self.scan.pk)

    def test_source_context_is_read_from_the_project_archive(self):
        res = self.client.get(self.detail_url('semgrep_0'))
        context = res.data['source_context']
        self.assertIsNotNone(context)
        self.assertTrue(context['code'].strip())
        self.assertLessEqual(context['start_line'], 5)
        self.assertGreaterEqual(context['end_line'], 6)
        self.assertIn('Dashboard', context['code'])

    def test_source_context_is_bounded(self):
        """Only a small window may leave the backend."""
        long_file = '\n'.join(f'const line{i} = {i};' for i in range(1, 501))
        project = self.make_project(
            self.user,
            zip_bytes=make_zip_bytes({'src/long.js': long_file}),
        )
        scan = Scan.objects.create(
            project=project,
            scanners=['semgrep'],
            status='completed',
            stage='done',
            progress=100,
            started_at=timezone.now(),
            result={
                'validation': {'isValid': True},
                'scans': {
                    'semgrep': {
                        'all_vulnerabilities': [
                            {
                                'check_id': 'x',
                                'path': 'src/long.js',
                                'start': {'line': 100},
                                'end': {'line': 100},
                                'extra': {'severity': 'ERROR', 'message': 'boom', 'lines': 'x'},
                            },
                        ],
                    },
                },
            },
        )
        res = self.client.get(f'/api/scans/{scan.pk}/findings/semgrep_0/')
        context = res.data['source_context']
        self.assertIsNotNone(context)
        self.assertLessEqual(len(context['code'].splitlines()), 40)
        self.assertLessEqual(len(context['code']), 4000)

    def test_gitleaks_secret_is_masked(self):
        res = self.client.get(self.detail_url('gitleaks_0'))
        body = res.content.decode()
        self.assertNotIn('sk-live-SUPERSECRET123', body)
        finding = res.data['finding']
        self.assertIn('[REDACTED]', finding['code_snippet'])
        self.assertTrue(finding['secret_detected'])

    def test_semgrep_placeholder_is_not_shown_as_code(self):
        res = self.client.get(self.detail_url('semgrep_1'))
        self.assertEqual(res.data['finding']['code_snippet'], '')

    def test_unknown_finding_returns_404(self):
        res = self.client.get(self.detail_url('semgrep_999'))
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_dependency_finding_with_a_slash_resolves(self):
        res = self.client.get(self.detail_url('dep_@babel/core'))
        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        self.assertEqual(res.data['finding']['id'], 'dep_@babel/core')
        self.assertEqual(res.data['finding']['severity'], 'high')

    def test_percent_encoded_finding_id_resolves(self):
        res = self.client.get(self.detail_url('dep_%40babel/core'))
        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        self.assertEqual(res.data['finding']['id'], 'dep_@babel/core')


# ─────────────────────────────────────────────────────────────────────────────
# POST — the AI explanation
# ─────────────────────────────────────────────────────────────────────────────

class FindingExplanationEndpointTests(ExplanationTestBase):
    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_streaming_endpoint_forwards_real_provider_deltas_and_completion(self):
        markdown = '## Vulnerability overview\n\nEscape user input.'
        provider_response = openai_stream_response(markdown)
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=provider_response,
        ) as post:
            response = self.client.post(
                f'{self.explain_url("semgrep_0")}?stream=1',
                {'finding_id': 'semgrep_0'},
                format='json',
            )
            events = b''.join(response.streaming_content).decode('utf-8')

        self.assertEqual(response.status_code, http_status.HTTP_200_OK)
        self.assertTrue(response['Content-Type'].startswith('text/event-stream'))
        self.assertEqual(response['Cache-Control'], 'no-cache, no-transform')
        self.assertEqual(response['X-Accel-Buffering'], 'no')
        self.assertIn('event: content', events)
        self.assertIn(json.dumps({'text': markdown}, separators=(',', ':')), events)
        self.assertIn('event: complete', events)
        self.assertIn('"format":"text"', events)
        self.assertTrue(post.call_args.kwargs['stream'])
        self.assertTrue(provider_response.close.called)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_streaming_provider_errors_are_sent_as_actionable_error_events(self):
        error_response = fake_response(status_code=429, headers={'Retry-After': '12'})
        error_response.close = mock.Mock()
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=error_response,
        ):
            response = self.client.post(
                f'{self.explain_url("semgrep_0")}?stream=1',
                {'finding_id': 'semgrep_0'},
                format='json',
            )
            events = b''.join(response.streaming_content).decode('utf-8')

        self.assertIn('event: error', events)
        self.assertIn('"code":"ai_rate_limited"', events)
        self.assertIn('"retry_after":12', events)
    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_successful_explanation_returns_the_canonical_payload(self):
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response(json.dumps(AI_JSON_ANSWER))):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        explanation = res.data['explanation']

        self.assertEqual(explanation['format'], 'structured')
        self.assertEqual(explanation['summary'], AI_JSON_ANSWER['summary'])
        self.assertEqual(explanation['how_to_fix'], AI_JSON_ANSWER['how_to_fix'])
        self.assertEqual(
            explanation['safer_example']['code'],
            AI_JSON_ANSWER['safer_example']['code'],
        )
        self.assertEqual(
            explanation['references'][0]['url'],
            AI_JSON_ANSWER['references'][0]['url'],
        )
        self.assertEqual(explanation['provider'], 'openai')
        self.assertTrue(explanation['model'])
        self.assertTrue(explanation['generated_at'])

        # The finding is returned as well, and it is the requested one.
        self.assertEqual(res.data['finding']['id'], 'semgrep_0')
        self.assertEqual(res.data['finding']['file'], SOURCE_FILE)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_client_cannot_inject_the_explanation(self):
        """The body may name a finding, never the content of the answer."""
        injected = {
            'explanation': {'summary': 'TOTALLY FABRICATED'},
            'summary': 'TOTALLY FABRICATED',
            'finding': {'id': 'semgrep_0', 'title': 'TOTALLY FABRICATED'},
        }
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response(json.dumps(AI_JSON_ANSWER))):
            res = self.explain('semgrep_0', body=injected)

        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        self.assertNotEqual(res.data['explanation']['summary'], 'TOTALLY FABRICATED')
        self.assertEqual(res.data['explanation']['summary'], AI_JSON_ANSWER['summary'])
        self.assertNotEqual(res.data['finding']['title'], 'TOTALLY FABRICATED')

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_only_the_finding_and_a_small_window_reach_the_provider(self):
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response(json.dumps(AI_JSON_ANSWER))) as post:
            self.explain('semgrep_0')

        self.assertEqual(post.call_count, 1)
        sent = json.dumps(post.call_args.kwargs['json'])
        self.assertIn(SOURCE_FILE, sent)
        self.assertIn('CWE-79', sent)
        # The rest of the uploaded project must not be sent.
        self.assertNotIn(UNRELATED_MARKER, sent)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_the_secret_never_reaches_the_provider(self):
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response(json.dumps(AI_JSON_ANSWER))) as post:
            res = self.explain('gitleaks_0')

        sent = json.dumps(post.call_args.kwargs['json'])
        self.assertNotIn('sk-live-SUPERSECRET123', sent)
        self.assertIn('[REDACTED]', sent)
        self.assertNotIn('sk-live-SUPERSECRET123', res.content.decode())

    @override_settings(
        AI_PROVIDER='auto', OPENAI_API_KEY='', ANTHROPIC_API_KEY='',
        OPENROUTER_API_KEY='',
    )
    def test_missing_configuration_returns_503(self):
        res = self.explain('semgrep_0')
        self.assertEqual(res.status_code, http_status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(res.data['code'], 'ai_not_configured')
        self.assertFalse(res.data['retryable'])
        self.assertIn('error', res.data)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_provider_timeout_returns_504(self):
        import requests as requests_lib

        with mock.patch('scans.services.ai_provider.requests.post',
                        side_effect=requests_lib.exceptions.Timeout()):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_504_GATEWAY_TIMEOUT)
        self.assertEqual(res.data['code'], 'ai_timeout')
        self.assertTrue(res.data['retryable'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_provider_rate_limit_returns_429(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=429, headers={'Retry-After': '30'}),
        ):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(res.data['code'], 'ai_rate_limited')
        self.assertTrue(res.data['retryable'])
        self.assertEqual(res.data['retry_after'], 30)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_invalid_credentials_return_502(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=401, payload={'error': 'invalid key'}),
        ):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(res.data['code'], 'ai_invalid_credentials')
        self.assertFalse(res.data['retryable'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_unavailable_provider_returns_503(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=503),
        ):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(res.data['code'], 'ai_unavailable')
        self.assertTrue(res.data['retryable'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_unparseable_http_response_returns_502(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=200, json_error=ValueError('not json')),
        ):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(res.data['code'], 'ai_invalid_response')

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_empty_answer_returns_502(self):
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response('   ')):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(res.data['code'], 'ai_invalid_response')

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_a_prose_answer_is_kept_as_text(self):
        """A non-JSON answer is degraded to text, not thrown away."""
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=openai_response('The query is concatenated into SQL.'),
        ):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        explanation = res.data['explanation']
        self.assertEqual(explanation['format'], 'text')
        self.assertIn('concatenated', explanation['raw_markdown'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_the_api_key_is_never_echoed_back(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(
                status_code=401,
                payload={'error': {'message': 'Incorrect API key provided: sk-test-key'}},
            ),
        ):
            res = self.explain('semgrep_0')

        self.assertEqual(res.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertNotIn('sk-test-key', res.content.decode())

    def test_unauthenticated_is_rejected(self):
        self.client.credentials()
        res = self.client.post(self.explain_url('semgrep_0'), {}, format='json')
        self.assertEqual(res.status_code, http_status.HTTP_401_UNAUTHORIZED)

    def test_foreign_scan_returns_404(self):
        intruder = self.make_user()
        self.login(intruder)
        res = self.explain('semgrep_0')
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)

    def test_unknown_finding_returns_404(self):
        res = self.explain('semgrep_999')
        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_dependency_finding_with_a_slash_resolves(self):
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response(json.dumps(AI_JSON_ANSWER))):
            res = self.explain('dep_@babel/core')

        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        self.assertEqual(res.data['finding']['id'], 'dep_@babel/core')

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_the_finding_id_may_be_sent_in_the_body_only(self):
        """Some proxies rewrite the path — the body is an accepted fallback."""
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response(json.dumps(AI_JSON_ANSWER))):
            res = self.client.post(
                f'/api/scans/{self.scan.pk}/findings/rewritten-by-proxy/explain/',
                {'finding_id': 'semgrep_1'},
                format='json',
            )

        self.assertEqual(res.status_code, http_status.HTTP_200_OK, res.data)
        self.assertEqual(res.data['finding']['id'], 'semgrep_1')


# ─────────────────────────────────────────────────────────────────────────────
# Provider adapter units
# ─────────────────────────────────────────────────────────────────────────────

class ProviderAdapterTests(ScanTestEnvironment, AuthMixin, APITestCase):
    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key',
                       OPENAI_BASE_URL='https://provider.test/v1', OPENAI_MODEL='test-model')
    def test_openai_adapter_builds_the_expected_request(self):
        from scans.services.ai_provider import OpenAIChatProvider

        provider = OpenAIChatProvider(
            api_key='sk-test-key',
            model='test-model',
            base_url='https://provider.test/v1',
        )
        with mock.patch('scans.services.ai_provider.requests.post',
                        return_value=openai_response('hello')) as post:
            self.assertEqual(provider.complete('system', 'user'), 'hello')

        self.assertEqual(post.call_args.args[0], 'https://provider.test/v1/chat/completions')
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer sk-test-key')
        self.assertEqual(post.call_args.kwargs['json']['model'], 'test-model')
        self.assertEqual(post.call_args.kwargs['json']['messages'][0]['role'], 'system')
        self.assertEqual(post.call_args.kwargs['json']['messages'][1]['content'], 'user')

    @override_settings(AI_PROVIDER='anthropic', ANTHROPIC_API_KEY='sk-ant-test',
                       ANTHROPIC_BASE_URL='https://anthropic.test', ANTHROPIC_MODEL='claude-test')
    def test_anthropic_adapter_builds_the_expected_request(self):
        from scans.services.ai_provider import AnthropicMessagesProvider

        provider = AnthropicMessagesProvider(
            api_key='sk-ant-test',
            model='claude-test',
            base_url='https://anthropic.test',
        )
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(payload={'content': [{'type': 'text', 'text': 'answer'}]}),
        ) as post:
            self.assertEqual(provider.complete('system', 'user'), 'answer')

        self.assertEqual(post.call_args.args[0], 'https://anthropic.test/v1/messages')
        self.assertEqual(post.call_args.kwargs['headers']['x-api-key'], 'sk-ant-test')
        self.assertEqual(post.call_args.kwargs['json']['system'], 'system')
        self.assertEqual(post.call_args.kwargs['json']['messages'][0]['content'], 'user')

    def test_anthropic_adapter_yields_text_from_its_event_stream(self):
        from scans.services.ai_provider import AnthropicMessagesProvider

        response = fake_response()
        response.iter_lines.return_value = [
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"part one"}}',
            b'',
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" part two"}}',
            b'',
            b'data: {"type":"message_stop"}',
        ]
        response.close = mock.Mock()
        provider = AnthropicMessagesProvider(api_key='sk-ant-test')
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=response,
        ) as post:
            text = ''.join(provider.stream_complete('system', 'user'))

        self.assertEqual(text, 'part one part two')
        self.assertTrue(post.call_args.kwargs['json']['stream'])
        self.assertTrue(post.call_args.kwargs['stream'])
        self.assertTrue(response.close.called)

    @override_settings(AI_PROVIDER='auto', OPENAI_API_KEY='', ANTHROPIC_API_KEY='',
                       OPENROUTER_API_KEY='')
    def test_auto_provider_without_credentials_raises_configuration_error(self):
        from scans.services.ai_provider import AIConfigurationError, get_ai_provider

        with self.assertRaises(AIConfigurationError):
            get_ai_provider()

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_empty_api_key_is_rejected_before_any_request(self):
        from scans.services.ai_provider import AIConfigurationError, OpenAIChatProvider

        provider = OpenAIChatProvider(api_key='   ')
        with mock.patch('scans.services.ai_provider.requests.post') as post:
            with self.assertRaises(AIConfigurationError):
                provider.complete('system', 'user')
        post.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# OpenRouter (OpenAI-compatible gateway)
# ─────────────────────────────────────────────────────────────────────────────

class OpenRouterProviderTests(ScanTestEnvironment, AuthMixin, APITestCase):
    @override_settings(
        AI_PROVIDER='openrouter',
        OPENROUTER_API_KEY='sk-or-test',
        OPENROUTER_BASE_URL='https://openrouter.test/api/v1',
        OPENROUTER_MODEL='minimax/minimax-m3.1-flash:free',
        OPENROUTER_SITE_URL='',
        OPENROUTER_APP_NAME='',
        OPENROUTER_REASONING_EFFORT='',
    )
    def test_the_adapter_builds_the_expected_request(self):
        from scans.services.ai_provider import OpenRouterProvider

        provider = OpenRouterProvider(
            api_key='sk-or-test',
            model='minimax/minimax-m3.1-flash:free',
            base_url='https://openrouter.test/api/v1',
        )
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=openai_response('answer'),
        ) as post:
            self.assertEqual(provider.complete('system', 'user'), 'answer')

        self.assertEqual(post.call_args.args[0], 'https://openrouter.test/api/v1/chat/completions')
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer sk-or-test')
        self.assertEqual(post.call_args.kwargs['json']['model'], 'minimax/minimax-m3.1-flash:free')
        self.assertEqual(post.call_args.kwargs['json']['messages'][0]['content'], 'system')
        self.assertEqual(post.call_args.kwargs['json']['messages'][1]['content'], 'user')

    @override_settings(
        OPENROUTER_SITE_URL='http://localhost:4028',
        OPENROUTER_APP_NAME='CodeGuard',
    )
    def test_the_attribution_headers_are_sent_when_configured(self):
        from scans.services.ai_provider import OpenRouterProvider

        provider = OpenRouterProvider(api_key='sk-or-test')
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=openai_response('answer'),
        ) as post:
            provider.complete('system', 'user')

        headers = post.call_args.kwargs['headers']
        self.assertEqual(headers['HTTP-Referer'], 'http://localhost:4028')
        self.assertEqual(headers['X-Title'], 'CodeGuard')

    @override_settings(OPENROUTER_REASONING_EFFORT='low')
    def test_the_reasoning_effort_is_only_sent_when_configured(self):
        from scans.services.ai_provider import OpenRouterProvider

        provider = OpenRouterProvider(api_key='sk-or-test')
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=openai_response('answer'),
        ) as post:
            provider.complete('system', 'user')

        self.assertEqual(post.call_args.kwargs['json']['reasoning_effort'], 'low')

    @override_settings(OPENROUTER_REASONING_EFFORT='')
    def test_the_reasoning_effort_is_omitted_by_default(self):
        from scans.services.ai_provider import OpenRouterProvider

        provider = OpenRouterProvider(api_key='sk-or-test')
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=openai_response('answer'),
        ) as post:
            provider.complete('system', 'user')

        self.assertNotIn('reasoning_effort', post.call_args.kwargs['json'])

    @override_settings(
        AI_PROVIDER='auto',
        OPENAI_API_KEY='',
        ANTHROPIC_API_KEY='',
        OPENROUTER_API_KEY='sk-or-test',
        OPENROUTER_MODEL='minimax/minimax-m3.1-flash:free',
    )
    def test_auto_mode_picks_openrouter_when_it_is_the_only_key(self):
        from scans.services.ai_provider import get_ai_provider

        provider = get_ai_provider()
        self.assertEqual(provider.name, 'openrouter')
        self.assertEqual(provider.api_key, 'sk-or-test')

    @override_settings(
        AI_PROVIDER='openrouter',
        OPENROUTER_API_KEY='sk-or-test',
        OPENROUTER_MODEL='minimax/minimax-m3.1-flash:free',
    )
    def test_the_endpoint_reports_the_openrouter_provider(self):
        from scans.services.ai_provider import get_ai_provider

        provider = get_ai_provider()
        self.assertEqual(provider.name, 'openrouter')
        self.assertEqual(provider.model, 'minimax/minimax-m3.1-flash:free')

    @override_settings(
        AI_PROVIDER='auto',
        OPENAI_API_KEY='sk-openai-test',
        ANTHROPIC_API_KEY='',
        OPENROUTER_API_KEY='sk-or-test',
    )
    def test_auto_mode_prefers_openai_when_both_keys_are_present(self):
        from scans.services.ai_provider import get_ai_provider

        self.assertEqual(get_ai_provider().name, 'openai')


# ─────────────────────────────────────────────────────────────────────────────
# Provider error mapping
# ─────────────────────────────────────────────────────────────────────────────

class ProviderErrorMappingTests(ScanTestEnvironment, AuthMixin, APITestCase):
    """Every provider failure mode has to map onto a stable, actionable code."""

    def setUp(self):
        self.user = self.make_user()
        self.login(self.user)
        self.project = self.make_project(self.user, zip_bytes=make_zip_bytes(PROJECT_FILES))
        self.scan = Scan.objects.create(
            project=self.project,
            scanners=['semgrep'],
            status='completed',
            stage='done',
            progress=100,
            started_at=timezone.now(),
            completed_at=timezone.now(),
            result=SCAN_RESULT,
        )
        self.url = f'/api/scans/{self.scan.pk}/findings/semgrep_0/explain/'

    def explain(self):
        return self.client.post(self.url, {'finding_id': 'semgrep_0'}, format='json')

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_insufficient_credits_return_402(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=402, payload={'error': {'message': 'no credits'}}),
        ):
            res = self.explain()

        self.assertEqual(res.status_code, http_status.HTTP_402_PAYMENT_REQUIRED)
        self.assertEqual(res.data['code'], 'ai_insufficient_credits')
        self.assertFalse(res.data['retryable'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_an_unknown_model_returns_404(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=404, payload={'error': {'message': 'no model'}}),
        ):
            res = self.explain()

        self.assertEqual(res.status_code, http_status.HTTP_404_NOT_FOUND)
        self.assertEqual(res.data['code'], 'ai_model_unavailable')
        self.assertFalse(res.data['retryable'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_a_rejected_request_is_not_retryable(self):
        with mock.patch(
            'scans.services.ai_provider.requests.post',
            return_value=fake_response(status_code=400, payload={'error': {'message': 'bad request'}}),
        ):
            res = self.explain()

        self.assertEqual(res.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertFalse(res.data['retryable'])

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key')
    def test_an_answer_cut_short_by_the_token_limit_is_reported_as_incomplete(self):
        """A reasoning model can spend its whole budget thinking and answer nothing."""
        response = fake_response(payload={
            'choices': [{'message': {'content': ''}, 'finish_reason': 'length'}],
        })
        with mock.patch('scans.services.ai_provider.requests.post', return_value=response):
            res = self.explain()

        self.assertEqual(res.status_code, http_status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(res.data['code'], 'ai_incomplete_response')
        self.assertIn('tokens', res.data['error'].lower())

    @override_settings(AI_PROVIDER='anthropic', ANTHROPIC_API_KEY='sk-ant-test')
    def test_anthropic_max_tokens_is_reported_as_incomplete(self):
        response = fake_response(payload={
            'content': [{'type': 'text', 'text': ''}],
            'stop_reason': 'max_tokens',
        })
        with mock.patch('scans.services.ai_provider.requests.post', return_value=response):
            res = self.explain()

        self.assertEqual(res.data['code'], 'ai_incomplete_response')

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key', AI_MAX_TOKENS=1234)
    def test_the_token_limit_is_configurable(self):
        from scans.services.ai_provider import OpenAIChatProvider

        provider = OpenAIChatProvider(api_key='sk-test-key')
        self.assertEqual(provider.max_tokens, 1234)

    @override_settings(AI_PROVIDER='openai', OPENAI_API_KEY='sk-test-key', AI_MAX_TOKENS=0)
    def test_the_provider_default_is_used_when_no_limit_is_configured(self):
        from scans.services.ai_provider import OpenAIChatProvider

        provider = OpenAIChatProvider(api_key='sk-test-key')
        self.assertEqual(provider.max_tokens, OpenAIChatProvider.default_max_tokens)
