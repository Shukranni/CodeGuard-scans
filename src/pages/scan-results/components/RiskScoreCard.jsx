/**
 * RiskScoreCard — the overall risk score of a scan.
 *
 * The score is computed from the finding counts (see `summariseFindings`), so
 * it is a real derived value, not a metric read from the API. The band label
 * always accompanies the number so the score is never colour alone.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const RISK_BANDS = [
  { min: 80, label: 'Severe risk', tone: 'text-critical', bar: 'bg-critical', icon: 'OctagonAlert' },
  { min: 60, label: 'High risk', tone: 'text-high', bar: 'bg-high', icon: 'AlertTriangle' },
  { min: 40, label: 'Elevated risk', tone: 'text-medium', bar: 'bg-medium', icon: 'AlertCircle' },
  { min: 0, label: 'Low risk', tone: 'text-low', bar: 'bg-low', icon: 'ShieldCheck' },
];

const getBand = (score) =>
  RISK_BANDS.find((band) => (typeof score === 'number' ? score : 0) >= band.min) || RISK_BANDS[RISK_BANDS.length - 1];

const RiskScoreCard = ({ score, trend, label }) => {
  const value = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;
  const band = getBand(value);
  const hasTrend = typeof trend === 'number' && trend !== 0;

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {hasTrend ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium',
              trend > 0 ? 'text-error' : 'text-success',
            )}
          >
            <Icon name={trend > 0 ? 'TrendingUp' : 'TrendingDown'} size={14} aria-hidden="true" />
            {Math.abs(trend)}%
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className={cn('font-heading text-4xl font-bold tabular-nums', band.tone)}>{value}</span>
        <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Icon name={band.icon} size={14} className={band.tone} aria-hidden="true" />
        <span className={cn('text-xs font-semibold', band.tone)}>{band.label}</span>
      </div>

      <div className="mt-4">
        <div
          className="progress-container"
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${value} of 100 (${band.label})`}
        >
          <div className={cn('progress-bar', band.bar)} style={{ width: `${value}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Derived from the finding counts: 100 − (10×critical + 5×high + 2×medium).
        </p>
      </div>
    </section>
  );
};

export default RiskScoreCard;
