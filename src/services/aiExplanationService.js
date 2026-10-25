/**
 * Client for the AI explanation endpoints.
 *
 * The backend owns the AI credentials and returns the authoritative finding
 * data together with the explanation, so this module never invents metadata:
 * it only moves payloads between the API and the UI.
 *
 * These endpoints are used:
 *   GET  /api/scans/<scanId>/findings/<findingId>/           → finding + source
 *   POST /api/scans/<scanId>/findings/<findingId>/explain/   → AI explanation
 *   POST /api/scans/<scanId>/findings/<findingId>/chat/      → contextual follow-up answer
 *
 * Explanations are cached in memory for the lifetime of the tab so that
 * re-opening the modal for the same finding does not spend provider quota
 * twice.  The cache is wiped on sign-out (see AuthContext) so no explanation
 * can survive a change of account.
 */
import api from '../utils/api';
import { normalizeAiText, normalizeTextEncoding } from '../utils/normalizeTextEncoding';

/** Normalised error thrown by every function in this module. */
export class AiExplanationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AiExplanationError';
    this.code = options.code || 'ai_unknown_error';
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 0;
    this.retryAfter = options.retryAfter ?? null;
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Keyed by "<scanId>::<findingId>" so two findings of the same scan never
// share an entry and a finding of another scan can never be reused.
const explanationCache = new Map();
const detailCache = new Map();

const cacheKey = (scanId, findingId) => `${scanId}::${findingId}`;

/** Forget every cached explanation / finding detail (used on sign-out). */
export const clearExplanationCache = () => {
  explanationCache.clear();
  detailCache.clear();
};

/** Forget one cached explanation (used by "regenerate"). */
export const removeCachedExplanation = (scanId, findingId) => {
  explanationCache.delete(cacheKey(scanId, findingId));
};

/** Return a cached explanation without touching the network. */
export const getCachedExplanation = (scanId, findingId) =>
  explanationCache.get(cacheKey(scanId, findingId)) || null;

/** Return a cached finding detail without touching the network. */
export const getCachedFindingDetail = (scanId, findingId) =>
  detailCache.get(cacheKey(scanId, findingId)) || null;

/**
 * Encode a finding id for use inside a URL path.
 *
 * npm package names contain a "/" (e.g. "dep_@babel/core").  A raw "/" would
 * start a new path segment, so it is percent-encoded; the backend
 * percent-decodes the segment again before resolving the finding.
 */
export const encodeFindingId = (findingId) =>
  String(findingId ?? '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

// ── Error mapping ────────────────────────────────────────────────────────────

const NETWORK_ERROR = () =>
  new AiExplanationError(
    'Cannot reach the server. Please check your connection and try again.',
    { code: 'network_error', retryable: true },
  );

/**
 * Turn any failure into an {@link AiExplanationError} with a stable code.
 *
 * The backend already answers with `{ error, code, retryable }`; this only
 * adds the transport level failures (no response at all) and makes sure no
 * raw stack trace can reach the UI.
 */
export const normalizeError = (error) => {
  if (error instanceof AiExplanationError) return error;

  const response = error?.response;

  if (!response) {
    if (
      error?.name === 'CanceledError' ||
      error?.name === 'AbortError' ||
      error?.code === 'ERR_CANCELED'
    ) {
      return new AiExplanationError('Request cancelled.', {
        code: 'cancelled',
        retryable: true,
      });
    }
    return NETWORK_ERROR();
  }

  const body = response.data && typeof response.data === 'object' ? response.data : {};
  const status = response.status;

  let code = body.code;
  if (!code) {
    if (status === 404) code = 'not_found';
    else if (status === 401 || status === 403) code = 'unauthorized';
    else if (status === 429) code = 'ai_rate_limited';
    else if (status === 503) code = 'ai_unavailable';
    else if (status === 504) code = 'ai_timeout';
    else code = 'ai_unknown_error';
  }

  const message =
    body.error ||
    body.detail ||
    (status === 404
      ? 'The requested item was not found.'
      : 'The request could not be completed. Please try again.');

  return new AiExplanationError(message, {
    code,
    retryable:
      typeof body.retryable === 'boolean'
        ? body.retryable
        : status === 429 || status === 503 || status === 504 || status >= 500,
    status,
    retryAfter: body.retry_after ?? null,
  });
};

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * Load the authoritative finding data (and the real source window) for one
 * finding of a scan.
 */
export const getFindingDetail = async (scanId, findingId, options = {}) => {
  if (!scanId || !findingId) {
    throw new AiExplanationError(
      'A scan and a finding must be selected before an explanation can be loaded.',
      { code: 'missing_identifiers', retryable: false },
    );
  }

  const key = cacheKey(scanId, findingId);
  if (!options.force && !options.signal && detailCache.has(key)) {
    return detailCache.get(key);
  }

  try {
    const { data } = await api.get(
      `/api/scans/${encodeURIComponent(scanId)}/findings/${encodeFindingId(findingId)}/`,
      { signal: options.signal },
    );
    const detail = {
      finding: data?.finding ?? null,
      source_context: data?.source_context ?? null,
      scan: data?.scan ?? null,
    };
    detailCache.set(key, detail);
    return detail;
  } catch (error) {
    throw normalizeError(error);
  }
};

/**
 * Ask the backend for an AI explanation of one finding.
 *
 * The request body repeats the finding id so the backend can still resolve
 * the finding when the path segment was rewritten by a proxy.
 */
export const requestExplanation = async (scanId, findingId, options = {}) => {
  if (!scanId || !findingId) {
    throw new AiExplanationError(
      'A scan and a finding must be selected before an explanation can be requested.',
      { code: 'missing_identifiers', retryable: false },
    );
  }

  try {
    const { data } = await api.post(
      `/api/scans/${encodeURIComponent(scanId)}/findings/${encodeFindingId(findingId)}/explain/`,
      { finding_id: findingId },
      { signal: options.signal },
    );

    const explanation = normalizeAiText(data?.explanation ?? null);
    const payload = {
      finding: data?.finding ?? null,
      source_context: data?.source_context ?? null,
      explanation,
    };

    if (explanation) {
      explanationCache.set(cacheKey(scanId, findingId), payload);
    }
    return payload;
  } catch (error) {
    throw normalizeError(error);
  }
};

/** Send a follow-up question with the prior turns for the selected finding. */
export const chatAboutFinding = async (scanId, findingId, message, history = [], options = {}) => {
  if (!scanId || !findingId) {
    throw new AiExplanationError(
      'A scan and a finding must be selected before starting a chat.',
      { code: 'missing_identifiers', retryable: false },
    );
  }

  try {
    const { data } = await api.post(
      `/api/scans/${encodeURIComponent(scanId)}/findings/${encodeFindingId(findingId)}/chat/`,
      { finding_id: findingId, message, history },
      { signal: options.signal },
    );
    if (typeof data?.answer !== 'string' || !data.answer.trim()) {
      throw new AiExplanationError('The assistant returned an empty answer.', {
        code: 'ai_invalid_response',
        retryable: true,
      });
    }
    return { ...data, answer: normalizeTextEncoding(data.answer) };
  } catch (error) {
    throw normalizeError(error);
  }
};

const streamUrl = (scanId, findingId) => {
  const baseUrl = String(api.defaults.baseURL || '').replace(/\/+$/, '');
  return `${baseUrl}/api/scans/${encodeURIComponent(scanId)}/findings/${encodeFindingId(
    findingId,
  )}/explain/?stream=1`;
};

const fetchStream = async (url, body, signal) => {
  const accessToken = () => window.localStorage?.getItem('access_token');
  const clearAuthentication = () => {
    window.localStorage?.removeItem('access_token');
    window.localStorage?.removeItem('refresh_token');
    window.dispatchEvent(new Event('auth:logout'));
  };
  const send = (token) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

  let response = await send(accessToken());
  if (response.status !== 401) return response;

  const refresh = window.localStorage?.getItem('refresh_token');
  if (!refresh) {
    clearAuthentication();
    return response;
  }

  let data;
  try {
    ({ data } = await api.post(
      '/api/auth/token/refresh/',
      { refresh },
      { signal },
    ));
  } catch (error) {
    if (signal?.aborted) throw error;
    clearAuthentication();
    throw error;
  }

  window.localStorage?.setItem('access_token', data.access);
  if (data.refresh) window.localStorage?.setItem('refresh_token', data.refresh);
  response = await send(data.access);
  if (response.status !== 401) return response;

  clearAuthentication();
  return response;
};

const parseSseFrame = (frame) => {
  let event = 'message';
  const data = [];
  frame.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  });
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    throw new AiExplanationError('The server returned an invalid streamed response.', {
      code: 'ai_invalid_response',
      retryable: true,
    });
  }
};

/**
 * Consume a genuine server-sent event stream from the configured AI provider.
 * Content callbacks are invoked only for text actually received from the server.
 */
export const streamExplanation = async (scanId, findingId, options = {}) => {
  if (!scanId || !findingId) {
    throw new AiExplanationError(
      'A scan and a finding must be selected before an explanation can be requested.',
      { code: 'missing_identifiers', retryable: false },
    );
  }

  let reader;
  try {
    const response = await fetchStream(
      streamUrl(scanId, findingId),
      { finding_id: findingId },
      options.signal,
    );
    if (!response.ok) {
      let body = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      throw normalizeError({ response: { status: response.status, data: body } });
    }
    if (!response.body?.getReader) {
      throw new AiExplanationError('Streaming is not available in this browser.', {
        code: 'stream_unavailable',
        retryable: false,
      });
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let pending = '';
    let completedPayload = null;

    const handleFrame = (frame) => {
      const parsed = parseSseFrame(frame);
      if (!parsed) return;
      if (parsed.event === 'content') {
        if (typeof parsed.data?.text !== 'string') {
          throw new AiExplanationError('The server returned an invalid streamed response.', {
            code: 'ai_invalid_response',
            retryable: true,
          });
        }
        if (parsed.data.text) options.onChunk?.(parsed.data.text);
      } else if (parsed.event === 'complete') {
        completedPayload = normalizeAiText(parsed.data);
      } else if (parsed.event === 'error') {
        throw normalizeError({
          response: { status: 502, data: parsed.data || {} },
        });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let boundary = pending.match(/\r?\n\r?\n/);
      while (boundary) {
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        handleFrame(frame);
        boundary = pending.match(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    if (pending.trim()) handleFrame(pending);
    if (
      !completedPayload?.explanation ||
      typeof completedPayload.explanation !== 'object' ||
      Array.isArray(completedPayload.explanation)
    ) {
      throw new AiExplanationError('The explanation stream ended before completion.', {
        code: 'stream_interrupted',
        retryable: true,
      });
    }

    explanationCache.set(cacheKey(scanId, findingId), completedPayload);
    return completedPayload;
  } catch (error) {
    throw normalizeError(error);
  } finally {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already have been closed or aborted.
      }
      reader.releaseLock();
    }
  }
};

export default {
  clearExplanationCache,
  removeCachedExplanation,
  getCachedExplanation,
  getCachedFindingDetail,
  encodeFindingId,
  normalizeError,
  getFindingDetail,
  requestExplanation,
  chatAboutFinding,
  streamExplanation,
};
