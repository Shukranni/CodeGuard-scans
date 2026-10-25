/**
 * CodePreviewPanel — syntax-less code viewer with finding annotations and safe highlighting.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/common';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { Skeleton } from '../../../components/ui/Skeleton';
import SeverityBadge, { getSeverityConfig } from '../../../components/ui/SeverityBadge';
import { cn } from '../../../utils/cn';

const normalizePath = (p) =>
  (p || '')
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LANGUAGE_BY_EXTENSION = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  java: 'java',
  php: 'php',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  vue: 'xml',
  svelte: 'xml',
  css: 'css',
  scss: 'scss',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  bash: 'bash',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  sql: 'sql',
  kt: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  r: 'r',
  dart: 'dart',
};

const resolveLanguage = (file, declaredLanguage) => {
  const extension = file?.path?.split('.').pop()?.toLowerCase();
  const language =
    LANGUAGE_BY_EXTENSION[extension] ||
    String(declaredLanguage || '').toLowerCase();
  return hljs.getLanguage(language) ? language : null;
};

const addSearchMarks = (html, searchQuery) => {
  if (!searchQuery || typeof document === 'undefined') return html;

  const container = document.createElement('span');
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, 4);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  const regex = new RegExp(escapeRegex(searchQuery), 'gi');
  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue || '';
    regex.lastIndex = 0;
    if (!regex.test(text)) return;
    regex.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const mark = document.createElement('mark');
      mark.className = 'rounded bg-warning/40 text-foreground';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      lastIndex = match.index + match[0].length;
    }
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  });

  return container.innerHTML;
};

const CodePreviewPanel = ({
  file,
  fileContent,
  loading,
  error,
  findings = [],
  selectedFinding,
  onFindingClick,
  className,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [jumpToLine, setJumpToLine] = useState('');
  const [highlightedLine, setHighlightedLine] = useState(null);
  const containerRef = useRef(null);
  const lines = useMemo(
    () => (fileContent ? String(fileContent.content || '').split('\n') : []),
    [fileContent],
  );

  // Scanner line numbers are one-based; rendered row IDs use those same numbers.
  useEffect(() => {
    const lineNumber = Number(selectedFinding?.line);
    const findingPath = normalizePath(selectedFinding?.resolvedPath || selectedFinding?.file);
    const isForCurrentFile = findingPath && findingPath === normalizePath(file?.path);
    const isValidLine =
      Number.isInteger(lineNumber) && lineNumber > 0 && lineNumber <= lines.length;

    setHighlightedLine(null);
    if (!isForCurrentFile || !isValidLine || !fileContent) return;

    setHighlightedLine(lineNumber);
    const el = containerRef.current?.querySelector(`#line-${lineNumber}`);
    if (el) {
      const reduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    }
  }, [selectedFinding, fileContent, file, lines.length]);

  // Findings for THIS file
  const fileFindings = useMemo(() => {
    if (!file || !findings.length) return [];
    const normFile = normalizePath(file.path);
    return findings.filter((f) => normalizePath(f.resolvedPath) === normFile);
  }, [file, findings]);

  // Map line → findings
  const findingsByLine = useMemo(() => {
    const map = new Map();
    const contentLineCount = lines.length;
    const addFindingToLine = (line, finding) => {
      if (!map.has(line)) map.set(line, []);
      map.get(line).push(finding);
    };

    fileFindings.forEach((f) => {
      const startLine = Number(f.line);
      const endLine = Number(f.endLine) || startLine;

      if (Number.isInteger(startLine) && startLine > 0 && startLine <= contentLineCount) {
        const lastLine = Number.isInteger(endLine) && endLine >= startLine
          ? Math.min(endLine, contentLineCount)
          : startLine;
        for (let line = startLine; line <= lastLine; line += 1) {
          addFindingToLine(line, f);
        }
      }
    });
    return map;
  }, [fileFindings, lines.length]);

  const selectedFindingIndex = fileFindings.findIndex(
    (finding) => finding.id === selectedFinding?.id,
  );
  const selectedHasReportedLine =
    selectedFinding?.line !== null
    && selectedFinding?.line !== undefined
    && selectedFinding?.line !== '';
  const selectedLine = Number(selectedFinding?.line);
  const selectedLineIsValid =
    Number.isInteger(selectedLine) && selectedLine > 0 && selectedLine <= lines.length;
  const selectedFindingIsForFile =
    selectedFinding
    && normalizePath(selectedFinding.resolvedPath || selectedFinding.file) === normalizePath(file?.path);
  const activeLineSurface = {
    critical: 'bg-critical/25',
    high: 'bg-high/25',
    medium: 'bg-medium/25',
    low: 'bg-low/25',
  }[String(selectedFinding?.severity || '').toLowerCase()] || 'bg-primary/15';

  const handleJumpToLine = () => {
    const lineNum = parseInt(jumpToLine, 10);
    if (lineNum > 0) {
      setHighlightedLine(lineNum);
      const el = document.getElementById(`line-${lineNum}`);
      if (el) {
        const reduced =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      }
    }
  };

  const handleCopy = () => {
    if (fileContent?.content) {
      navigator.clipboard.writeText(fileContent.content).catch(() => {});
    }
  };

  // ── No file selected ──────────────────────────────────────────────────────────
  if (!file) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center',
          className,
        )}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon name="FileCode" size={30} aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-base font-semibold text-foreground">No file selected</h3>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          Select a file from the tree to view its contents and vulnerability annotations.
        </p>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card', className)}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        <div className="flex items-center gap-3 border-b border-border p-3">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <div className="flex-1 space-y-1 p-4">
          {Array.from({ length: 14 }).map((_, idx) => (
            <Skeleton key={idx} className="h-5 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error / binary / unsupported ──────────────────────────────────────────────
  if (error) {
    const icons = { binary: 'FileX2', notfound: 'FileQuestion', error: 'AlertCircle' };
    const iconName = icons[error.type] || 'AlertCircle';
    const tone = error.type === 'warning' || error.type === 'notfound' ? 'warning' : 'error';
    return (
      <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card', className)}>
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Icon name="FileCode" size={20} className="text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{file.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{file.path}</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <span
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-2xl',
              tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error',
            )}
          >
            <Icon name={iconName} size={26} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-foreground">
            {error.type === 'binary' ? 'Binary file' : error.type === 'notfound' ? 'File not found' : 'Failed to load file'}
          </h3>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!fileContent) return null;

  const language = resolveLanguage(file, fileContent.language);

  return (
    <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card', className)}>
      {/* File header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="FileCode" size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{fileContent.name || file.name}</h3>
            <p className="truncate font-mono text-xs text-muted-foreground">{fileContent.path || file.path}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fileFindings.length > 0 ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-high/25 bg-high/10 px-2.5 py-1">
              <Icon name="AlertTriangle" size={14} className="text-high" aria-hidden="true" />
              <span className="text-xs font-medium text-high">
                {fileFindings.length} {fileFindings.length === 1 ? 'issue' : 'issues'}
              </span>
            </div>
          ) : null}
          {fileContent.truncated ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-1">
              <Icon name="AlertCircle" size={12} className="text-warning" aria-hidden="true" />
              <span className="text-xs text-warning">Preview truncated</span>
            </div>
          ) : null}
          <Button variant="outline" size="sm" iconName="Copy" iconPosition="left" onClick={handleCopy}>
            Copy
          </Button>
        </div>
      </div>

      {/* Search / jump toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-[12rem] flex-1">
          <Icon
            name="Search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search in file…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search in file"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            placeholder="Line #"
            value={jumpToLine}
            onChange={(e) => setJumpToLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJumpToLine();
            }}
            className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Jump to line"
          />
          <Button variant="outline" size="sm" onClick={handleJumpToLine} iconName="ArrowRight" iconPosition="right">
            Jump
          </Button>
        </div>
      </div>

      {/* Current finding and navigation */}
      {selectedFindingIsForFile ? (
        <div className="space-y-2 border-b border-border px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <SeverityBadge severity={selectedFinding.severity} size="xs" />
              <span className="truncate text-xs font-semibold text-foreground">
                {selectedFinding.title}
              </span>
              {selectedFinding.scanner ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {selectedFinding.scanner}
                </span>
              ) : null}
              <span className="shrink-0 text-xs text-muted-foreground">
                Line {selectedHasReportedLine ? selectedFinding.line : 'not reported'}
              </span>
            </div>
            {fileFindings.length > 1 ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Finding {selectedFindingIndex >= 0 ? selectedFindingIndex + 1 : '—'} of {fileFindings.length}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  iconName="ChevronLeft"
                  iconPosition="left"
                  aria-label="Previous finding"
                  title="Previous finding"
                  disabled={selectedFindingIndex <= 0}
                  onClick={() => onFindingClick?.(fileFindings[selectedFindingIndex - 1])}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  iconName="ChevronRight"
                  iconPosition="right"
                  aria-label="Next finding"
                  title="Next finding"
                  disabled={selectedFindingIndex < 0 || selectedFindingIndex >= fileFindings.length - 1}
                  onClick={() => onFindingClick?.(fileFindings[selectedFindingIndex + 1])}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
          {selectedHasReportedLine && !selectedLineIsValid ? (
            <p role="status" className="text-xs text-warning">
              Reported line {selectedFinding.line} is outside this file's loaded range ({lines.length} lines).
            </p>
          ) : !selectedHasReportedLine ? (
            <p role="status" className="text-xs text-muted-foreground">
              The scanner did not report a source line for this finding.
            </p>
          ) : null}
        </div>
      ) : fileFindings.length > 1 ? (
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-xs text-muted-foreground">{fileFindings.length} findings in this file</span>
          {fileFindings.map((finding) => (
            <button
              key={finding.id}
              type="button"
              onClick={() => onFindingClick?.(finding)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                getSeverityConfig(finding.severity).badge,
              )}
              aria-label={`Select ${finding.title}, line ${finding.line || 'not reported'}`}
            >
              L{finding.line || '?'}
            </button>
          ))}
        </div>
      ) : null}

      {/* Code lines */}
      <div className="flex-1 overflow-auto" ref={containerRef}>
        <div className="min-w-max font-mono text-xs">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const lineFindings = findingsByLine.get(lineNumber) || [];
            const hasFindings = lineFindings.length > 0;
            const isHighlighted = lineNumber === highlightedLine;
            const isActiveFindingLine = lineFindings.some(
              (finding) => finding.id === selectedFinding?.id,
            );
            const highestFinding = lineFindings[0];
            const highestCfg = highestFinding ? getSeverityConfig(highestFinding.severity) : null;

            const hasSearchMatch =
              !!searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase());
            const highlightedHtml = language
              ? hljs.highlight(line || ' ', { language, ignoreIllegals: true }).value
              : escapeHtml(line || ' ');
            const contentHtml = addSearchMarks(highlightedHtml, searchQuery);

            return (
              <div
                key={lineNumber}
                id={`line-${lineNumber}`}
                className={cn(
                  'group flex items-stretch border-l-2 transition-colors',
                  hasFindings && highestCfg
                    ? cn(highestCfg.surface, 'border-l-current')
                    : 'border-l-transparent',
                  isActiveFindingLine
                    ? cn(activeLineSurface, 'z-[1] border-l-4 ring-2 ring-inset ring-primary/70')
                    : isHighlighted
                      ? 'ring-1 ring-inset ring-primary/60'
                      : hasSearchMatch
                        ? 'bg-warning/5'
                        : 'hover:bg-muted/20',
                )}
                aria-current={isActiveFindingLine ? 'location' : undefined}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (hasFindings && lineFindings[0]) {
                      onFindingClick?.(lineFindings[0]);
                    }
                    setHighlightedLine(lineNumber);
                  }}
                  className="w-14 flex-shrink-0 select-none px-3 py-0.5 text-right text-[11px] text-muted-foreground hover:text-foreground"
                  aria-label={`Line ${lineNumber}`}
                >
                  {lineNumber}
                </button>
                <div className="flex-1 overflow-x-auto px-4 py-0.5">
                  <pre
                    className="hljs whitespace-pre leading-6 text-foreground"
                    dangerouslySetInnerHTML={{ __html: contentHtml }}
                  />
                </div>
                {hasFindings ? (
                  <div className="flex flex-shrink-0 items-center gap-1 px-2">
                    {lineFindings.map((f, idx) => {
                      const cfg = getSeverityConfig(f.severity);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onFindingClick?.(f)}
                          className={cn(
                            'rounded p-0.5 transition-colors hover:bg-muted',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            cfg.text,
                          )}
                          title={`${cfg.label}: ${f.title}`}
                          aria-label={`${cfg.label} finding on line ${lineNumber}`}
                        >
                          <Icon name={cfg.icon} size={14} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span>Lines: {lines.length}</span>
          {searchQuery ? (
            <span>
              Matches:{' '}
              {
                lines.filter((l) => l.toLowerCase().includes(searchQuery.toLowerCase()))
                  .length
              }
            </span>
          ) : null}
          {fileFindings.length > 0 ? (
            <span className="text-high">
              {fileFindings.length} security {fileFindings.length === 1 ? 'issue' : 'issues'}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {fileContent.size != null ? (
            <span>
              {fileContent.size > 1024
                ? `${(fileContent.size / 1024).toFixed(1)} KB`
                : `${fileContent.size} B`}
            </span>
          ) : null}
          <span className="rounded bg-muted/40 px-2 py-0.5">
            {fileContent.language || 'Unknown'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CodePreviewPanel;
