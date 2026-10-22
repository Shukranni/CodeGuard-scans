/**
 * FindingDetailsPanel — list and inspect findings for the current project.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import SeverityBadge, { SEVERITY_ORDER, getSeverityConfig } from '../../../components/ui/SeverityBadge';
import { cn } from '../../../utils/cn';

const FindingDetailsPanel = ({
  finding,
  findings = [],
  onSelectFinding,
  onClose,
  onViewAI,
  className,
}) => {
  const [filter, setFilter] = useState('all'); // 'all' | 'critical' | 'high' | 'medium' | 'low'

  const sortedFindings = [...findings].sort((a, b) => {
    const ao = SEVERITY_ORDER.indexOf(String(a.severity || '').toLowerCase());
    const bo = SEVERITY_ORDER.indexOf(String(b.severity || '').toLowerCase());
    return (bo === -1 ? 99 : bo) - (ao === -1 ? 99 : ao);
  });

  const filteredFindings =
    filter === 'all'
      ? sortedFindings
      : sortedFindings.filter(
          (f) => String(f.severity || '').toLowerCase() === filter,
        );

  const counts = findings.reduce((acc, f) => {
    const sev = String(f.severity || '').toLowerCase();
    if (sev) acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, {});

  const filters = ['all', 'critical', 'high', 'medium', 'low'];

  const activeCfg = finding ? getSeverityConfig(finding.severity) : null;

  return (
    <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-high/10 text-high">
            <Icon name="ShieldAlert" size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Findings</h2>
            <p className="text-xs text-muted-foreground">{findings.length} total</p>
          </div>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close findings panel"
            type="button"
          >
            <Icon name="X" size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Severity filter chips */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-2">
        {filters.map((sev) => {
          const isActive = filter === sev;
          return (
            <button
              key={sev}
              onClick={() => setFilter(sev)}
              className={cn(
                'flex flex-shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              type="button"
            >
              {sev === 'all'
                ? `All ${findings.length}`
                : `${sev} ${counts[sev] || 0}`}
            </button>
          );
        })}
      </div>

      {/* Finding list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredFindings.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">No findings match this filter</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredFindings.map((f) => {
              const isSelected = finding?.id === f.id;
              const cfg = getSeverityConfig(f.severity);
              return (
                <button
                  key={f.id}
                  onClick={() => onSelectFinding?.(f)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isSelected ? 'bg-primary/5' : 'hover:bg-muted/30',
                  )}
                  type="button"
                >
                  <span className={cn('mt-0.5 flex-shrink-0', cfg.text)}>
                    <Icon name={cfg.icon} size={14} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{f.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} size="xs" />
                      {f.line > 0 ? (
                        <span className="text-[11px] text-muted-foreground">L{f.line}</span>
                      ) : null}
                      {f.file ? (
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {f.file.split('/').pop()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isSelected ? (
                    <Icon
                      name="ChevronRight"
                      size={14}
                      className="mt-0.5 flex-shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Finding detail */}
      {finding ? (
        <div className="max-h-[40%] min-h-[12rem] flex-shrink-0 overflow-y-auto border-t border-border">
          <div className={cn('border-b border-border p-4', activeCfg?.surface)}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold leading-tight text-foreground">
                {finding.title}
              </h3>
              <SeverityBadge severity={finding.severity} size="sm" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {finding.scanner ? (
                <span className="flex items-center gap-1">
                  <Icon name="Shield" size={12} aria-hidden="true" />
                  {finding.scanner}
                </span>
              ) : null}
              {finding.line > 0 ? (
                <span className="flex items-center gap-1">
                  <Icon name="Hash" size={12} aria-hidden="true" />
                  Line {finding.line}
                </span>
              ) : null}
              {finding.file ? (
                <span className="flex max-w-[200px] items-center gap-1 truncate font-mono">
                  <Icon name="FileCode" size={12} aria-hidden="true" />
                  {finding.file}
                </span>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 p-4">
            {finding.description ? (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                  Description
                </h4>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {finding.description}
                </p>
              </div>
            ) : null}

            {finding.codeSnippet ? (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                  Affected code
                </h4>
                <div className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
                  <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
                    {finding.codeSnippet}
                  </pre>
                </div>
              </div>
            ) : null}

            {finding.remediation ? (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                  Remediation
                </h4>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {finding.remediation}
                </p>
              </div>
            ) : null}

            {(finding.cwe || finding.owasp) ? (
              <div className="flex flex-wrap gap-2">
                {finding.cwe ? (
                  <span className="rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
                    {finding.cwe}
                  </span>
                ) : null}
                {finding.owasp ? (
                  <span className="rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                    {finding.owasp}
                  </span>
                ) : null}
              </div>
            ) : null}

            {onViewAI ? (
              <Button
                variant="outline"
                fullWidth
                iconName="Sparkles"
                iconPosition="left"
                onClick={onViewAI}
              >
                AI explanation
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">Select a finding to view details</p>
        </div>
      )}
    </div>
  );
};

export default FindingDetailsPanel;
