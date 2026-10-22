/**
 * ScanLogs — the live event log of a scan.
 *
 * Entries are appended only when the server snapshot actually changes (see
 * `diffSnapshotLogs`), so the log is a faithful record of the lifecycle.
 * The download button exports exactly what is on screen as a text file.
 */
import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { cn } from '../../../utils/cn';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

const LEVEL_ICON = {
  info: 'Info',
  success: 'CheckCircle2',
  warning: 'AlertTriangle',
  error: 'XCircle',
};

const LEVEL_TEXT = {
  info: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const formatTime = (value) =>
  new Date(value)?.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const ScanLogs = ({ logs = [] }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);

  const filteredLogs = filter === 'all' ? logs : logs.filter((log) => log?.level === filter);

  useEffect(() => {
    if (!autoScroll || !logsEndRef.current) return;
    logsEndRef.current.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [filteredLogs, autoScroll]);

  const handleDownload = () => {
    if (!filteredLogs.length) return;
    const body = filteredLogs
      .map((log) => `[${formatTime(log?.timestamp)}] ${String(log?.level || 'info').toUpperCase()}  ${log?.message}`)
      .join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codeguard-scan-log-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon name="Terminal" size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Scan log</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDownload}
            disabled={!filteredLogs.length}
            aria-label="Download the visible log entries"
            title="Download log"
          >
            <Icon name="Download" size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsExpanded((open) => !open)}
            aria-expanded={isExpanded}
            aria-controls="scan-log-body"
            aria-label={isExpanded ? 'Collapse scan log' : 'Expand scan log'}
          >
            <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {isExpanded ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-5">
            <div role="group" aria-label="Filter log entries" className="flex flex-wrap items-center gap-1">
              {FILTERS.map((option) => {
                const isActive = filter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    aria-pressed={isActive}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setAutoScroll((value) => !value)}
              aria-pressed={autoScroll}
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                autoScroll
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon name={autoScroll ? 'Lock' : 'Unlock'} size={13} aria-hidden="true" />
              <span className="hidden sm:inline">Auto-scroll</span>
              <span className="sr-only sm:hidden">Auto-scroll</span>
            </button>
          </div>

          <div
            id="scan-log-body"
            className="overflow-elegant h-64 bg-muted/20 p-4 font-data text-xs md:h-80 md:text-sm"
            tabIndex={0}
            role="region"
            aria-label="Scan event log"
          >
            {filteredLogs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No log entries for the selected filter.
              </div>
            ) : (
              <ol className="space-y-0.5">
                {filteredLogs.map((log) => (
                  <li
                    key={log?.id}
                    className="flex items-start gap-3 rounded px-2 py-1 transition-colors hover:bg-muted/40"
                  >
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatTime(log?.timestamp)}
                    </span>
                    <Icon
                      name={LEVEL_ICON[log?.level] || 'Info'}
                      size={13}
                      className={cn('mt-0.5 shrink-0', LEVEL_TEXT[log?.level] || 'text-muted-foreground')}
                      aria-hidden="true"
                    />
                    <span className={cn('break-all', LEVEL_TEXT[log?.level] || 'text-muted-foreground')}>
                      {log?.message}
                    </span>
                  </li>
                ))}
                <li ref={logsEndRef} aria-hidden="true" />
              </ol>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
};

export default ScanLogs;
