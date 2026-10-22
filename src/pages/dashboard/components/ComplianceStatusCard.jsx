/**
 * ComplianceStatusCard — OWASP Top 10 coverage for the workspace.
 *
 * The API reports `status` as `passed` or `partial`; both are mapped to a
 * labelled badge so the state is never communicated by colour alone.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const STATUS_MAP = {
  passed: {
    label: 'Compliant',
    icon: 'ShieldCheck',
    chip: 'bg-success/10 text-success border-success/25',
    bar: 'bg-success',
  },
  compliant: {
    label: 'Compliant',
    icon: 'ShieldCheck',
    chip: 'bg-success/10 text-success border-success/25',
    bar: 'bg-success',
  },
  partial: {
    label: 'Partial coverage',
    icon: 'AlertCircle',
    chip: 'bg-warning/10 text-warning border-warning/25',
    bar: 'bg-warning',
  },
  failed: {
    label: 'Not compliant',
    icon: 'ShieldAlert',
    chip: 'bg-error/10 text-error border-error/25',
    bar: 'bg-error',
  },
};

const DEFAULT_STATUS = {
  label: 'Unknown',
  icon: 'CircleHelp',
  chip: 'bg-muted text-muted-foreground border-border',
  bar: 'bg-muted-foreground',
};

const ComplianceStatusCard = ({ standard, coverage, status, categories }) => {
  const tone = STATUS_MAP[status] || DEFAULT_STATUS;
  const percentage = Math.max(0, Math.min(100, Number(coverage) || 0));

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{standard}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Coverage analysis</p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
            tone.chip,
          )}
        >
          <Icon name={tone.icon} size={13} aria-hidden="true" />
          {tone.label}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">Overall coverage</span>
          <span className="text-sm font-semibold tabular-nums text-foreground">{percentage}%</span>
        </div>
        <div
          className="progress-container mt-2"
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${standard} coverage`}
        >
          <div className={cn('progress-bar', tone.bar)} style={{ width: `${percentage}%` }} />
        </div>
      </div>

      {categories?.length ? (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Category breakdown
          </h4>
          <ul className="mt-2 space-y-1.5">
            {categories.map((category, index) => (
              <li
                key={`${category?.name}-${index}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    name={category?.covered ? 'CheckCircle2' : 'CircleMinus'}
                    size={15}
                    aria-hidden="true"
                    className={category?.covered ? 'text-success' : 'text-muted-foreground'}
                  />
                  <span className="truncate text-sm text-foreground">{category?.name}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {category?.findings ?? 0} findings
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export default ComplianceStatusCard;
