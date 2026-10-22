/**
 * Client for the AI explanation endpoints.
 *
 * The backend owns the AI credentials and returns the authoritative finding
 * data together with the explanation, so this module never invents metadata:
 * it only moves payloads between the API and the UI.
 *
 * Two endpoints are used:
 *   GET  /api/scans/<scanId>/findings/<findingId>/           → finding + source
 *   POST /api/scans/<scanId>/findings/<findingId>/explain/   → AI explanation
 *
 * Explanations are cached in memory for the lifetime of the tab so that
 * re-opening the modal for the same finding does not spend provider quota
 * twice.  The cache is wiped on sign-out (see AuthContext) so no explanation
 * can survive a change of account.
 */
import api from '../utils/api';

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
    if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
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

    const explanation = data?.explanation ?? null;
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

export default {
  clearExplanationCache,
  removeCachedExplanation,
  getCachedExplanation,
  getCachedFindingDetail,
  encodeFindingId,
  normalizeError,
  getFindingDetail,
  requestExplanation,
};
