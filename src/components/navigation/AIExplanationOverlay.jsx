import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../AppIcon';
import Button from '../ui/Button';
import Markdown from '../ui/Markdown';
import SeverityBadge from '../ui/SeverityBadge';
import { cn } from '../../utils/cn';
import {
  getCachedExplanation,
  getFindingDetail,
  removeCachedExplanation,
  requestExplanation,
} from '../../services/aiExplanationService';

/**
 * AI explanation modal.
 *
 * The modal never invents data:
 *   * the finding facts come from the backend (`GET /api/scans/<id>/findings/<fid>/`),
 *     which resolves the finding from the stored scan result, so the metadata
 *     always matches the finding the user clicked;
 *   * the source snippet is read from the uploaded project archive by the
 *     backend — the browser only displays it;
 *   * the explanation itself is produced by the AI provider on the server.
 *     The provider credentials never reach this component.
 *
 * States: idle (nothing generated yet) → loading → ready | empty | error.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Severity styling now handled by SeverityBadge

const ERROR_HINTS = {
  ai_not_configured:
    'AI explanations are not configured on this server. An administrator has to set OPENAI_API_KEY, ANTHROPIC_API_KEY or OPENROUTER_API_KEY in the backend environment.',
  ai_invalid_credentials:
    'The server rejected its AI provider credentials. An administrator has to check the configured API key.',
  ai_insufficient_credits:
    'The AI provider account has no credits left. An administrator has to top up the provider account.',
  ai_model_unavailable:
    'The configured AI model is not available. An administrator has to check the configured model name.',
  ai_rate_limited:
    'The AI provider is rate limiting requests. Wait a moment before trying again.',
  ai_timeout: 'The AI provider took too long to answer. Please try again.',
  ai_unavailable: 'The AI provider is unavailable at the moment. Please try again shortly.',
  ai_invalid_response:
    'The AI provider returned an answer that could not be read. Please try again.',
  ai_incomplete_response:
    'The AI provider ran out of tokens before it could finish the answer. Please try again.',
  not_found: 'This finding does not exist in the selected scan any more.',
  unauthorized: 'Your session has expired. Please sign in again.',
  network_error: 'Cannot reach the server. Please check your connection and try again.',
  missing_identifiers: 'The finding could not be identified. Please open it from the scan results.',
};

const MISSING_TARGET_ERROR = {
  code: 'missing_identifiers',
  message: 'This finding could not be identified. Please open it from the scan results.',
};

const hasContent = (explanation) => {
  if (!explanation) return false;
  if (explanation.format === 'text') {
    return Boolean(String(explanation.raw_markdown || '').trim());
  }
  return Boolean(
    String(explanation.summary || '').trim() ||
      String(explanation.what_it_means || '').trim() ||
      String(explanation.why_it_matters || '').trim() ||
      String(explanation.where_it_occurs || '').trim() ||
      (explanation.how_to_fix || []).length ||
      String(explanation.safer_example?.code || '').trim() ||
      (explanation.additional_recommendations || []).length,
  );
};

const formatTimestamp = (value) => {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  } catch {
    return '';
  }
};

const Fact = ({ label, value, mono = false }) => (
  <div className="flex items-start justify-between gap-3">
    <dt className="text-muted-foreground flex-shrink-0">{label}</dt>
    <dd
      className={`text-right text-foreground break-all ${
        mono ? 'font-data text-[11px]' : ''
      }`}
    >
      {value === null || value === undefined || value === '' ? (
        <span className="text-muted-foreground italic">Not provided</span>
      ) : (
        value
      )}
    </dd>
  </div>
);

const Section = ({ letter, title, children }) => (
  <section aria-labelledby={`ai-section-${letter}`}>
    <div className="flex items-center gap-2 mb-2">
      <span className="w-6 h-6 rounded-md bg-primary/10 text-primary text-[11px] font-heading font-bold flex items-center justify-center flex-shrink-0">
        {letter}
      </span>
      <h3 id={`ai-section-${letter}`} className="text-sm font-heading font-semibold text-foreground">
        {title}
      </h3>
    </div>
    {children}
  </section>
);

const SkeletonBlock = ({ className = 'h-4 w-full' }) => (
  <div className={`skeleton ${className}`} />
);

const LoadingSkeleton = () => (
  <div className="space-y-6" role="status" aria-live="polite">
    <span className="sr-only">Generating the AI explanation…</span>
    {[0, 1, 2, 3].map((index) => (
      <div key={index} className="space-y-2">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-4 w-full" />
        <SkeletonBlock className="h-4 w-11/12" />
        <SkeletonBlock className="h-4 w-8/12" />
      </div>
    ))}
  </div>
);

const AIExplanationOverlay = ({
  scanId,
  findingId,
  finding: findingProp,
  onExport,
  onResolve,
  onClose,
}) => {
  const dialogRef = useRef(null);
  const detailAbortRef = useRef(null);
  const explainAbortRef = useRef(null);
  const requestSeqRef = useRef(0);
  const explainInFlightRef = useRef(false);

  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('loading');
  const [detailError, setDetailError] = useState(null);

  const [explanation, setExplanation] = useState(null);
  const [explanationState, setExplanationState] = useState('idle');
  const [explanationError, setExplanationError] = useState(null);

  const finding = detail?.finding || null;
  const sourceContext = detail?.source_context || null;

  // ── Load the authoritative finding data ───────────────────────────────────
  useEffect(() => {
    if (!scanId || !findingId) {
      // Handled by the derived state below — nothing to fetch.
      return undefined;
    }

    const controller = new AbortController();
    detailAbortRef.current = controller;
    let cancelled = false;

    setDetailState('loading');
    setDetailError(null);

    getFindingDetail(scanId, findingId, { signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload);
        setDetailState('ready');
      })
      .catch((error) => {
        if (cancelled || error?.code === 'cancelled') return;
        setDetailError(error);
        setDetailState('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scanId, findingId]);

  // ── Reset the explanation whenever a different finding is opened ──────────
  useEffect(() => {
    requestSeqRef.current += 1;
    explainInFlightRef.current = false;
    explainAbortRef.current?.abort();

    const cached = getCachedExplanation(scanId, findingId);
    if (cached?.explanation && hasContent(cached.explanation)) {
      setExplanation(cached.explanation);
      setExplanationState('ready');
    } else {
      setExplanation(null);
      setExplanationState('idle');
    }
    setExplanationError(null);
  }, [scanId, findingId]);

  // ── Ask the backend for the explanation ───────────────────────────────────
  const generate = useCallback(
    async ({ force = false } = {}) => {
      if (!scanId || !findingId) return;
      if (explainInFlightRef.current) return; // never fire two requests at once

      explainInFlightRef.current = true;
      const seq = (requestSeqRef.current += 1);

      const controller = new AbortController();
      explainAbortRef.current = controller;

      setExplanationState('loading');
      setExplanationError(null);

      try {
        if (force) removeCachedExplanation(scanId, findingId);
        const payload = await requestExplanation(scanId, findingId, {
          signal: controller.signal,
        });
        if (seq !== requestSeqRef.current) return; // a newer request won

        const result = payload?.explanation;
        if (!result || !hasContent(result)) {
          setExplanation(null);
          setExplanationState('empty');
        } else {
          setExplanation(result);
          setExplanationState('ready');
        }
      } catch (error) {
        if (seq !== requestSeqRef.current) return;
        if (error?.code === 'cancelled') return;
        setExplanationError(error);
        setExplanationState('error');
      } finally {
        if (seq === requestSeqRef.current) {
          explainInFlightRef.current = false;
        }
      }
    },
    [scanId, findingId],
  );

  // ── Abort pending requests when the modal unmounts ────────────────────────
  useEffect(
    () => () => {
      detailAbortRef.current?.abort();
      explainAbortRef.current?.abort();
    },
    [],
  );

  // ── Scroll lock + focus restore ──────────────────────────────────────────
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  // ── Keyboard handling: Escape + focus trap ────────────────────────────────
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const node = dialogRef.current;
      if (!node) return;

      const focusable = Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
      );

      if (!focusable.length) {
        event.preventDefault();
        node.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (event) => {
      if (event.target === event.currentTarget) onClose?.();
    },
    [onClose],
  );

  // ── Derived values ────────────────────────────────────────────────────────
  // A modal without a target is an error state from the very first render —
  // it must not flash a loading skeleton and it must not depend on an effect.
  const missingTarget = !scanId || !findingId;
  const detailStatus = missingTarget ? 'error' : detailState;
  const detailFailure = missingTarget ? MISSING_TARGET_ERROR : detailError;

  const severity = String(finding?.severity || findingProp?.severity || '').toLowerCase();
  const title =
    finding?.title ||
    findingProp?.title ||
    (detailStatus === 'loading' ? 'Loading finding…' : 'Security finding');

  const lineLabel = useMemo(() => {
    const start = finding?.line;
    const end = finding?.end_line;
    if (!start) return '';
    if (end && end !== start) return `${start}–${end}`;
    return String(start);
  }, [finding?.line, finding?.end_line]);

  const generatedMeta = useMemo(() => {
    if (!explanation) return '';
    const parts = [];
    if (explanation.provider) parts.push(explanation.provider);
    if (explanation.model) parts.push(explanation.model);
    const stamp = formatTimestamp(explanation.generated_at);
    if (stamp) parts.push(stamp);
    return parts.join(' · ');
  }, [explanation]);

  const codeLines = useMemo(() => {
    if (!sourceContext?.code) return [];
    return String(sourceContext.code).split('\n');
  }, [sourceContext?.code]);

  const canGenerate = Boolean(scanId && findingId) && explanationState !== 'loading';

  return (
    <div
      className="fixed inset-0 z-[1030] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-explanation-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative w-full h-full sm:h-auto sm:max-w-5xl sm:max-h-[92vh] bg-card border border-border sm:rounded-xl shadow-xl flex flex-col overflow-hidden focus:outline-none"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 p-4 sm:p-5 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon name="Sparkles" size={22} className="text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="ai-explanation-title"
                className="text-base sm:text-xl font-heading font-semibold text-foreground truncate"
              >
                AI Security Analysis
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 truncate" title={title}>
                {title}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close AI explanation"
            className="flex-shrink-0"
          >
            <Icon name="X" size={20} />
          </Button>
        </header>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            {/* ── Left: the real finding data ─────────────────────────────── */}
            <aside className="border-b lg:border-b-0 lg:border-r border-border bg-muted/20 p-4 sm:p-5 space-y-4">
              {detailStatus === 'loading' && (
                <div className="space-y-3" role="status" aria-live="polite">
                  <span className="sr-only">Loading finding details…</span>
                  <SkeletonBlock className="h-4 w-3/4" />
                  <SkeletonBlock className="h-3 w-full" />
                  <SkeletonBlock className="h-3 w-5/6" />
                  <SkeletonBlock className="h-3 w-2/3" />
                </div>
              )}

              {detailStatus === 'error' && (
                <div className="rounded-lg border border-error/30 bg-error/5 p-4" role="alert">
                  <div className="flex items-start gap-2">
                    <Icon name="AlertCircle" size={18} color="var(--color-error)" className="mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-error">Finding could not be loaded</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {detailFailure?.message ||
                          ERROR_HINTS[detailFailure?.code] ||
                          'The finding could not be loaded.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {detailStatus === 'ready' && finding && (
                <>
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-heading font-semibold text-foreground break-words">
                        {finding.title}
                      </h3>
                      {severity ? <SeverityBadge severity={severity} size="xs" /> : null}
                    </div>

                    {finding.description ? (
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed break-words">
                        {finding.description}
                      </p>
                    ) : null}

                    <dl className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs">
                      <Fact label="Scanner" value={finding.scanner} />
                      <Fact label="File" value={finding.file} mono />
                      <Fact label="Line" value={lineLabel} />
                      <Fact label="CWE" value={finding.cwe} />
                      <Fact label="OWASP" value={finding.owasp} />
                      <Fact label="Rule" value={finding.rule_id} mono />
                      <Fact label="Language" value={finding.language} />
                    </dl>
                  </div>

                  {sourceContext?.code ? (
                    <div className="rounded-lg border border-border bg-card overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-data text-muted-foreground truncate">
                          {sourceContext.path}
                        </span>
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">
                          {sourceContext.start_line}
                          {sourceContext.end_line && sourceContext.end_line !== sourceContext.start_line
                            ? `–${sourceContext.end_line}`
                            : ''}
                        </span>
                      </div>
                      <pre className="p-3 overflow-x-auto text-[11px] font-data leading-relaxed">
                        {codeLines.map((line, index) => {
                          const absolute = Number(sourceContext.start_line || 0) + index;
                          const inFinding =
                            finding.line &&
                            absolute >= Number(finding.line) &&
                            absolute <= Number(finding.end_line || finding.line);
                          return (
                            <div
                              key={`${absolute}-${index}`}
                              className={`flex gap-3 ${inFinding ? 'bg-warning/10' : ''}`}
                            >
                              <span className="w-8 shrink-0 text-right text-muted-foreground select-none">
                                {absolute}
                              </span>
                              <span className="whitespace-pre text-foreground">{line}</span>
                            </div>
                          );
                        })}
                      </pre>
                      {sourceContext.truncated ? (
                        <p className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground">
                          The snippet was truncated to keep the request small.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {finding.code_snippet ? (
                    <div className="rounded-lg border border-error/20 bg-error/5 overflow-hidden">
                      <div className="px-3 py-2 border-b border-error/20 text-[11px] font-medium text-error">
                        Snippet reported by {finding.scanner || 'the scanner'}
                      </div>
                      <pre className="p-3 overflow-x-auto text-[11px] font-data text-foreground whitespace-pre-wrap break-all">
                        {finding.code_snippet}
                      </pre>
                      {finding.secret_detected ? (
                        <p className="px-3 py-2 border-t border-error/20 text-[11px] text-muted-foreground">
                          The secret value is masked and never sent to the browser or the AI provider.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </aside>

            {/* ── Right: the explanation ─────────────────────────────────── */}
            <section className="p-4 sm:p-6 space-y-6 min-w-0">
              {explanationState === 'idle' && (
                <div className="flex flex-col items-center justify-center text-center py-10 sm:py-16">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                    <Icon name="Sparkles" size={28} className="text-primary" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground">
                    No explanation generated yet
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2 max-w-md">
                    CodeGuard sends this finding and a small window of the affected file to the
                    AI provider configured on the server. Nothing is sent until you ask for it.
                  </p>
                  <Button
                    className="mt-6"
                    iconName="Sparkles"
                    iconPosition="left"
                    onClick={() => generate()}
                    disabled={!canGenerate || detailStatus === 'error'}
                  >
                    Generate AI explanation
                  </Button>
                </div>
              )}

              {explanationState === 'loading' && <LoadingSkeleton />}

              {explanationState === 'empty' && (
                <div className="flex flex-col items-center justify-center text-center py-10 sm:py-16" role="status">
                  <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mb-4">
                    <Icon name="MessageSquareOff" size={28} color="var(--color-muted-foreground)" />
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground">
                    The provider returned an empty explanation
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2 max-w-md">
                    The request succeeded but the answer did not contain any usable content. You can
                    try again.
                  </p>
                  <Button
                    className="mt-6"
                    variant="outline"
                    iconName="RefreshCw"
                    iconPosition="left"
                    onClick={() => generate({ force: true })}
                    disabled={!canGenerate}
                  >
                    Try again
                  </Button>
                </div>
              )}

              {explanationState === 'error' && (
                <div
                  className="rounded-lg border border-error/30 bg-error/5 p-4 sm:p-5"
                  role="alert"
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      name="AlertCircle"
                      size={20}
                      color="var(--color-error)"
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-heading font-semibold text-error">
                        The explanation could not be generated
                      </h3>
                      <p className="text-sm text-foreground mt-1 break-words">
                        {explanationError?.message ||
                          ERROR_HINTS[explanationError?.code] ||
                          'The request failed. Please try again.'}
                      </p>
                      {explanationError?.code && ERROR_HINTS[explanationError.code] ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          {ERROR_HINTS[explanationError.code]}
                        </p>
                      ) : null}
                      {explanationError?.code ? (
                        <p className="text-[11px] font-data text-muted-foreground mt-2">
                          Error code: {explanationError.code}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          iconName="RefreshCw"
                          iconPosition="left"
                          onClick={() => generate({ force: true })}
                          disabled={!canGenerate}
                        >
                          Try again
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {explanationState === 'ready' && explanation && (
                <div className="space-y-6">
                  {explanation.summary ? (
                    <Section letter="A" title="Summary">
                      <p className="text-sm text-foreground/90 leading-relaxed">
                        {explanation.summary}
                      </p>
                    </Section>
                  ) : null}

                  {explanation.what_it_means ? (
                    <Section letter="B" title="What it means">
                      <Markdown content={explanation.what_it_means} />
                    </Section>
                  ) : null}

                  {explanation.why_it_matters ? (
                    <Section letter="C" title="Why it matters">
                      <Markdown content={explanation.why_it_matters} />
                    </Section>
                  ) : null}

                  {explanation.where_it_occurs ? (
                    <Section letter="D" title="Where it occurs">
                      <Markdown content={explanation.where_it_occurs} />
                    </Section>
                  ) : null}

                  {explanation.how_to_fix?.length ? (
                    <Section letter="E" title="How to fix">
                      <ol className="space-y-2 list-decimal pl-5 marker:text-muted-foreground">
                        {explanation.how_to_fix.map((step, index) => (
                          <li key={`step-${index}`} className="text-sm text-foreground/90">
                            <Markdown content={step} className="!text-sm" />
                          </li>
                        ))}
                      </ol>
                    </Section>
                  ) : null}

                  {explanation.safer_example?.code ? (
                    <Section letter="F" title="Safer example (illustrative)">
                      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 mb-3 flex items-start gap-2">
                        <Icon
                          name="Info"
                          size={16}
                          color="var(--color-warning)"
                          className="mt-0.5 flex-shrink-0"
                        />
                        <p className="text-xs text-muted-foreground">
                          This example was generated as an illustration. It was not applied to your
                          project, it was not tested against your code and it is not a verified
                          patch — review it before using it.
                        </p>
                      </div>
                      <div className="rounded-lg border border-success/30 bg-success/5 overflow-hidden">
                        <div className="px-3 py-2 border-b border-success/30 text-[11px] font-medium text-success">
                          Illustrative fix
                          {explanation.safer_example.language
                            ? ` · ${explanation.safer_example.language}`
                            : ''}
                        </div>
                        <pre className="p-3 overflow-x-auto text-xs font-data text-foreground whitespace-pre">
                          <code>{explanation.safer_example.code}</code>
                        </pre>
                      </div>
                      {explanation.safer_example.note ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          {explanation.safer_example.note}
                        </p>
                      ) : null}
                    </Section>
                  ) : null}

                  {explanation.additional_recommendations?.length ? (
                    <div>
                      <h3 className="text-sm font-heading font-semibold text-foreground mb-2">
                        Additional recommendations
                      </h3>
                      <ul className="space-y-1.5 list-disc pl-5 marker:text-muted-foreground">
                        {explanation.additional_recommendations.map((item, index) => (
                          <li key={`rec-${index}`} className="text-sm text-foreground/90">
                            <Markdown content={item} className="!text-sm" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {explanation.references?.length ? (
                    <div>
                      <h3 className="text-sm font-heading font-semibold text-foreground mb-2">
                        References
                      </h3>
                      <ul className="space-y-1.5">
                        {explanation.references.map((reference, index) => (
                          <li key={`ref-${index}`} className="text-sm">
                            <a
                              href={reference.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
                            >
                              {reference.title || reference.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground">
                      {generatedMeta || 'Generated by the configured AI provider.'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      iconName="RefreshCw"
                      iconPosition="left"
                      onClick={() => generate({ force: true })}
                      disabled={!canGenerate}
                    >
                      Regenerate
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="flex items-center justify-between gap-3 p-4 sm:p-5 border-t border-border flex-shrink-0 flex-wrap">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            {onExport ? (
              <Button
                variant="outline"
                iconName="Download"
                iconPosition="left"
                onClick={() => onExport('pdf')}
                disabled={explanationState !== 'ready'}
              >
                Export Report
              </Button>
            ) : null}
            {onResolve ? (
              <Button
                variant="default"
                iconName="CheckCircle"
                iconPosition="left"
                onClick={() => {
                  onResolve(findingId);
                  onClose?.();
                }}
              >
                Mark as Resolved
              </Button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default AIExplanationOverlay;
