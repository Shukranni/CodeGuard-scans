/**
 * CodePreviewPanel — syntax-less code viewer with finding annotations and safe highlighting.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { Skeleton } from '../../../components/ui/Skeleton';
import SeverityBadge, { getSeverityConfig } from '../../../components/ui/SeverityBadge';
import { cn } from '../../../utils/cn';

const normalizePath = (p) => (p || '').replace(/\\/g, '/').replace(/^\/+/, '');

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  // Scroll to selected finding's line
  useEffect(() => {
    if (selectedFinding?.line) {
      setHighlightedLine(selectedFinding.line);
      const el = document.getElementById(`line-${selectedFinding.line}`);
      if (el) {
        const reduced =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      }
    }
  }, [selectedFinding, fileContent]);

  // Findings for THIS file
  const fileFindings = useMemo(() => {
    if (!file || !findings.length) return [];
    const normFile = normalizePath(file.path);
    return findings.filter((f) => normalizePath(f.file) === normFile);
  }, [file, findings]);

  // Map line → findings
  const findingsByLine = useMemo(() => {
    const map = new Map();
    fileFindings.forEach((f) => {
      if (!f.line) return;
      if (!map.has(f.line)) map.set(f.line, []);
      map.get(f.line).push(f);
    });
    return map;
  }, [fileFindings]);

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

  const lines = String(fileContent.content || '').split('\n');

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

      {/* Finding navigation */}
      {fileFindings.length > 1 ? (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border p-3">
          <span className="flex-shrink-0 text-xs text-muted-foreground">Jump to finding</span>
          {fileFindings.map((f) => {
            const cfg = getSeverityConfig(f.severity);
            const isActive = selectedFinding?.id === f.id;
            return (
              <button
                key={f.id}
                onClick={() => onFindingClick?.(f)}
                className={cn(
                  'flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : cn(cfg.badge, 'hover:opacity-90'),
                )}
                type="button"
              >
                <Icon name={cfg.icon} size={12} aria-hidden="true" />
                <span>L{f.line || '?'}</span>
                <span className="uppercase tracking-wide">{cfg.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Code lines */}
      <div className="flex-1 overflow-auto" ref={containerRef}>
        <div className="min-w-max font-mono text-xs">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const lineFindings = findingsByLine.get(lineNumber) || [];
            const hasFindings = lineFindings.length > 0;
            const isHighlighted =
              lineNumber === highlightedLine || selectedFinding?.line === lineNumber;
            const highestFinding = lineFindings[0];
            const highestCfg = highestFinding ? getSeverityConfig(highestFinding.severity) : null;

            let contentHtml = escapeHtml(line || ' ');
            let hasSearchMatch = false;
            if (searchQuery) {
              const lowerLine = line.toLowerCase();
              const lowerQuery = searchQuery.toLowerCase();
              if (lowerLine.includes(lowerQuery)) {
                hasSearchMatch = true;
                try {
                  const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
                  contentHtml = escapeHtml(line || ' ').replace(
                    regex,
                    '<mark class="rounded bg-warning/40 text-foreground">$1</mark>',
                  );
                } catch {
                  // fall back to escaped content
                  contentHtml = escapeHtml(line || ' ');
                }
              }
            }

            return (
              <div
                key={lineNumber}
                id={`line-${lineNumber}`}
                className={cn(
                  'group flex items-stretch border-l-2 transition-colors',
                  hasFindings && highestCfg
                    ? cn(highestCfg.surface, 'border-l-current')
                    : 'border-l-transparent',
                  isHighlighted ? 'bg-primary/5' : hasSearchMatch ? 'bg-warning/5' : 'hover:bg-muted/20',
                )}
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
                    className="whitespace-pre leading-6 text-foreground"
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
