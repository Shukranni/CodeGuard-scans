/**
 * ScannerStatusPanel — real per-scanner execution state.
 *
 * The states come straight from `scanner_status` in the status snapshot.
 * Findings are intentionally absent: they are shown on the results page once
 * the scan reaches a terminal state.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import StatusBadge from '../../../components/ui/StatusBadge';
import { cn } from '../../../utils/cn';

const SCANNER_META = {
  semgrep: { label: 'Semgrep', description: 'Static code analysis', icon: 'Code' },
  gitleaks: { label: 'GitLeaks', description: 'Secret detection', icon: 'Key' },
  dependency: { label: 'npm audit', description: 'Dependency vulnerabilities', icon: 'Package' },
};

const ScannerStatusPanel = ({ snapshot }) => {
  const scanners = snapshot?.scanners || [];
  const scannerStates = snapshot?.scanner_status || {};

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
          <Icon name="Shield" size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Scanners</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {snapshot
              ? 'Execution state reported by the scan worker'
              : 'Waiting for status…'}
          </p>
        </div>
      </div>

      <div className="px-4 py-4 md:px-5">
        {scanners.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No scanners were selected for this scan.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {scanners.map((name) => {
              const meta = SCANNER_META[name] || { label: name, description: '', icon: 'Bug' };
              const state = scannerStates[name] || 'pending';

              return (
                <li
                  key={name}
                  className={cn(
                    'rounded-lg border bg-card p-3.5',
                    state === 'running'
                      ? 'border-primary/30 bg-primary/5'
                      : state === 'failed'
                        ? 'border-error/30 bg-error/5'
                        : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name={meta.icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate text-sm font-semibold text-foreground">{meta.label}</span>
                    </div>
                    <StatusBadge status={state} size="xs" />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{meta.description}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

export default ScannerStatusPanel;
