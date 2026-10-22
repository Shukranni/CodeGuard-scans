"""
A fake OpenAI-compatible ``/chat/completions`` server.

It exists to prove the *whole* backend path end-to-end without a real API key:
prompt building → HTTP call → strict JSON parsing → canonical payload → HTTP
response.  It also echoes back the prompt it received so the test can assert
that the real finding and the real source context were sent.

Usage:
    python scripts/fake_openai_server.py [port] [--mode structured|text|garbage|401|429|500]
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8899
MODE = 'structured'
for index, argument in enumerate(sys.argv):
    if argument == '--mode' and index + 1 < len(sys.argv):
        MODE = sys.argv[index + 1]

LAST_REQUEST = {}


STRUCTURED = {
    'summary': 'The route handler executes a shell command built from user input.',
    'what_it_means': 'The parameter `cmd` is concatenated into a shell command string '
                     'and passed to `child_process.exec`, so the shell interprets it.',
    'why_it_matters': 'An attacker who controls `cmd` can append `;` separated commands '
                      'and run them with the privileges of the Node.js process.',
    'where_it_occurs': 'The concatenation happens in the handler that passes the value to `exec`.',
    'how_to_fix': [
        'Use `execFile` with an argument array instead of `exec`.',
        'Validate the input against an allow-list of permitted commands.',
    ],
    'safer_example': {
        'language': 'javascript',
        'code': "execFile('git', ['status', '--short'], (err, stdout) => { /* ... */ });",
        'note': 'Arguments are passed to the process directly, so no shell parsing happens.',
    },
    'additional_recommendations': ['Run the worker with least privilege.', 'Add a regression test.'],
    'references': [
        {'title': 'OWASP Command Injection', 'url': 'https://owasp.org/www-community/attacks/Command_Injection'},
        {'title': 'Node.js child_process', 'url': 'https://nodejs.org/api/child_process.html'},
    ],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep the console readable
        pass

    def _send(self, status, payload, headers=None):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/__last_request__':
            return self._send(200, LAST_REQUEST)
        return self._send(404, {'error': 'not found'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length).decode('utf-8')

        # Control endpoint: switch the behaviour without restarting the server.
        if self.path.startswith('/__mode__/'):
            global MODE
            MODE = self.path.rsplit('/', 1)[-1] or 'structured'
            return self._send(200, {'mode': MODE})

        try:
            LAST_REQUEST['payload'] = json.loads(raw)
            LAST_REQUEST['authorization'] = self.headers.get('Authorization')
        except ValueError:
            LAST_REQUEST['payload'] = raw
            LAST_REQUEST['authorization'] = self.headers.get('Authorization')

        if MODE == '401':
            return self._send(401, {'error': {'message': 'Invalid API key'}})
        if MODE == '429':
            return self._send(429, {'error': {'message': 'Rate limited'}}, {'Retry-After': '12'})
        if MODE == '500':
            return self._send(500, {'error': {'message': 'Upstream failure'}})

        if MODE == 'garbage':
            content = 'I am sorry, I cannot help with that request.'
        elif MODE == 'text':
            content = (
                '## Overview\n\nThis endpoint builds a shell command from user input.\n\n'
                '```js\nconst { exec } = require("child_process");\n```\n'
            )
        else:
            content = json.dumps(STRUCTURED)

        self._send(200, {
            'id': 'chatcmpl-fake',
            'object': 'chat.completion',
            'model': 'fake-model',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': content},
                         'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 20, 'total_tokens': 30},
        })

    def do_GET(self):
        if self.path == '/__last_request__':
            return self._send(200, LAST_REQUEST)
        return self._send(404, {'error': 'not found'})


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f'fake OpenAI server on http://127.0.0.1:{PORT} (mode={MODE})', flush=True)
    server.serve_forever()
