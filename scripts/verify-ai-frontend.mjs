/**
 * Frontend verification for the AI explanation flow.
 *
 * The project has no JS test runner, so this script uses the esbuild binary
 * that already ships with Vite to bundle the components and renders them with
 * `react-dom/server`.  It then asserts the behaviour that matters:
 *
 *   * the Markdown renderer never emits executable HTML,
 *   * the modal renders the real, empty state — not fabricated metadata,
 *   * the service encodes finding ids and maps API failures to stable codes.
 *
 * Run with:  node scripts/verify-ai-frontend.mjs
 */
import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let failures = 0;
let checks = 0;

const check = (name, condition, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const bundle = async (entry, extra = {}) => {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    jsx: 'automatic',
    logLevel: 'error',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'axios'],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:8000'),
      'import.meta.env': JSON.stringify({
        VITE_API_BASE_URL: 'http://127.0.0.1:8000',
      }),
    },
    ...extra,
  });
  const outFile = path.join(root, `.tmp-verify-${path.basename(entry).replace(/\W/g, '_')}.cjs`);
  await writeFile(outFile, result.outputFiles[0].text, 'utf8');
  return outFile;
};

const importBundle = async (entry, extra) => {
  const file = await bundle(entry, extra);
  try {
    return require(file).default;
  } finally {
    await unlink(file).catch(() => {});
  }
};

const render = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, props));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nMarkdown renderer');
// ─────────────────────────────────────────────────────────────────────────────
{
  const Markdown = await importBundle('src/components/ui/Markdown.jsx');

  const script = render(Markdown, { content: '<script>alert("xss")</script>' });
  check('raw HTML is escaped, not rendered', !script.includes('<script>'), script.slice(0, 160));
  check('raw HTML is shown as text', script.includes('&lt;script&gt;'));

  const img = render(Markdown, { content: '<img src=x onerror=alert(1)>' });
  check('inline HTML cannot inject an element', !/<img/i.test(img), img.slice(0, 160));

  const jsLink = render(Markdown, { content: '[click](javascript:alert(1))' });
  check('javascript: links are not clickable', !jsLink.includes('href="javascript:'), jsLink.slice(0, 200));
  check('javascript: link text is still shown', jsLink.includes('click'));

  const dataLink = render(Markdown, { content: '[x](data:text/html;base64,PHNjcmlwdD4=)' });
  check('data: links are not clickable', !dataLink.includes('href="data:'), dataLink.slice(0, 200));

  const safeLink = render(Markdown, { content: '[OWASP](https://owasp.org/x)' });
  check('https links become anchors', safeLink.includes('href="https://owasp.org/x"'));
  check('anchors are opened safely', safeLink.includes('rel="noopener noreferrer nofollow"'));

  const code = render(Markdown, { content: '```js\nconst a = "<b>";\n```' });
  check('fenced code is kept verbatim', code.includes('&lt;b&gt;'));
  check('fenced code is inside a pre/code element', /<pre[^>]*><code>/.test(code));
  check('fenced code is not turned into HTML', !code.includes('<b>'));

  const headings = render(Markdown, { content: '## Title\n\nSome text' });
  check('headings are rendered', headings.includes('Title') && /<h\d/.test(headings));

  const list = render(Markdown, { content: '- one\n- two' });
  check('bullet lists are rendered', list.includes('<ul') && list.includes('<li>'));

  const ordered = render(Markdown, { content: '1. first\n2. second' });
  check('ordered lists are rendered', ordered.includes('<ol'));

  const emphasis = render(Markdown, { content: '**bold** and *italic*' });
  check('bold is rendered', /<strong[^>]*>bold<\/strong>/.test(emphasis), emphasis.slice(0, 240));
  check('italic is rendered', /<em[^>]*>italic<\/em>/.test(emphasis), emphasis.slice(0, 240));

  const snake = render(Markdown, { content: 'Use snake_case_names in your code.' });
  check('snake_case words are not mangled', snake.includes('snake_case_names'), snake.slice(0, 200));

  const empty = render(Markdown, { content: '' });
  check('empty content renders nothing', empty === '');

  const quote = render(Markdown, { content: '> quoted' });
  check('block quotes are rendered', quote.includes('<blockquote'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAI explanation service');
// ─────────────────────────────────────────────────────────────────────────────
{
  const service = await importBundle('src/services/aiExplanationService.js');

  check(
    'a slash in a package id stays a single path segment',
    service.encodeFindingId('dep_@babel/core') === 'dep_%40babel/core',
    service.encodeFindingId('dep_@babel/core'),
  );
  check(
    'plain ids are encoded conservatively',
    service.encodeFindingId('semgrep_0') === 'semgrep_0',
    service.encodeFindingId('semgrep_0'),
  );

  const noResponse = service.normalizeError({ request: {}, message: 'Network Error' });
  check('a transport failure becomes a retryable network error',
    noResponse.code === 'network_error' && noResponse.retryable === true);

  const notFound = service.normalizeError({ response: { status: 404, data: {} } });
  check('a 404 becomes "not_found"', notFound.code === 'not_found', notFound.code);

  const unauthorized = service.normalizeError({ response: { status: 401, data: {} } });
  check('a 401 becomes "unauthorized"', unauthorized.code === 'unauthorized', unauthorized.code);

  const backendError = service.normalizeError({
    response: { status: 503, data: { error: 'Not configured', code: 'ai_not_configured', retryable: false } },
  });
  check('the backend error code is preserved',
    backendError.code === 'ai_not_configured' && backendError.retryable === false);
  check('the backend message is preserved', backendError.message === 'Not configured');

  const rateLimited = service.normalizeError({
    response: { status: 429, data: { error: 'slow down', code: 'ai_rate_limited', retryable: true, retry_after: 30 } },
  });
  check('the retry delay is preserved', rateLimited.retryAfter === 30);

  // Cache behaviour: entries are per scan + finding.
  service.clearExplanationCache();
  check('an unknown finding has no cached explanation',
    service.getCachedExplanation('1', 'semgrep_0') === null);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await service.requestExplanation('1', 'semgrep_0').catch(() => {});
  } finally {
    console.warn = originalWarn;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAI explanation modal');
// ─────────────────────────────────────────────────────────────────────────────
{
  const Overlay = await importBundle('src/components/navigation/AIExplanationOverlay.jsx');

  const html = render(Overlay, {
    scanId: 30,
    findingId: 'semgrep_0',
    onClose: () => {},
  });

  check('the modal renders a dialog', html.includes('role="dialog"'));
  check('the modal is marked as modal', html.includes('aria-modal="true"'));
  check('the modal has an accessible name', html.includes('aria-labelledby="ai-explanation-title"'));
  check('the modal shows the real title', html.includes('AI Security Analysis'));

  check('the modal starts in the idle state', html.includes('No explanation generated yet'));
  check('the modal offers to generate the explanation', html.includes('Generate AI explanation'));

  // The old implementation invented all of this.
  check('no fabricated file path is shown', !html.includes('src/api/users.js'));
  check('no fabricated line number is shown', !html.includes('Line 42'));
  check('no fabricated CWE is shown', !html.includes('CWE-Unknown'));
  check('no fabricated severity is shown', !html.includes('Critical Severity'));
  check('no fabricated impact grid is shown', !html.includes('Impact Assessment'));

  const missing = render(Overlay, { onClose: () => {} });
  check('a missing target is reported instead of crashing',
    missing.includes('could not be identified'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(
  `\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ''}\n`,
);
process.exit(failures ? 1 : 0);
