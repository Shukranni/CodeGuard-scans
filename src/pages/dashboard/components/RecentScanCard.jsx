/**
 * RecentScanCard — a single scan in the dashboard's "recent scans" list.
 *
 * The card is a summary of the scan the API returned; it links to the results
 * page. Interactive elements are real links and buttons (never a click handler
 * on a non-interactive container) so the card is fully keyboard operable.
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import StatusBadge from '../../../components/ui/StatusBadge';
import { cn } from '../../../utils/cn';

/** Risk-score bands. A risk score is not a finding severity, so it gets its
 *  own vocabulary instead of borrowing the severity scale. */
const RISK_BANDS = [
  { min: 80, label: 'Severe risk', text: 'text-critical', chip: 'bg-critical/10 text-critical' },
  { min: 60, label: 'High risk', text: 'text-high', chip: 'bg-high/10 text-high' },
  { min: 40, label: 'Elevated risk', text: 'text-medium', chip: 'bg-medium/10 text-medium' },
  { min: 0, label: 'Low risk', text: 'text-low', chip: 'bg-low/10 text-low' },
];

export const getRiskBand = (score) =>
  RISK_BANDS.find((band) => Number(score || 0) >= band.min) || RISK_BANDS[RISK_BANDS.length - 1];

const formatRelativeDate = (dateString) => {
  if (!dateString) return 'Unknown date';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const Stat = ({ label, value, tone }) => (
  <div className="rounded-lg bg-muted/50 px-2.5 py-2">
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
    <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', tone || 'text-foreground')}>
      {value}
    </p>
  </div>
);

const RecentScanCard = ({ scan, onResolve }) => {
  const navigate = useNavigate();
  const risk = getRiskBand(scan?.riskScore);
  const isResolved = scan?.status === 'resolved';

  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-colors duration-150 hover:border-primary/40 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">
            <Link
              to="/scan-results"
              state={{ scanId: scan?.id }}
              className="rounded transition-colors hover:text-primary"
            >
              {scan?.projectName || 'Untitled project'}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Icon name="Clock" size={13} aria-hidden="true" />
            <span>{formatRelativeDate(scan?.timestamp)}</span>
            <span aria-hidden="true">·</span>
            <span>{scan?.scanType || 'Security Scan'}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
              risk.chip,
            )}
          >
            <Icon name="Gauge" size={12} aria-hidden="true" />
            {risk.label}
          </span>
          <StatusBadge status={scan?.status} size="sm" />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg bg-muted/50 px-2.5 py-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Risk score
          </dt>
          <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums', risk.text)}>
            {scan?.riskScore ?? 0}
          </dd>
        </div>
        <Stat label="Critical" value={scan?.findings?.critical ?? 0} tone="text-critical" />
        <Stat label="High" value={scan?.findings?.high ?? 0} tone="text-high" />
        <Stat label="Total" value={scan?.findings?.total ?? 0} />
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="FileCode" size={13} aria-hidden="true" />
          {scan?.filesScanned ?? 0} files scanned
        </p>

        <div className="flex items-center gap-2">
          {!isResolved ? (
            <Button
              variant="outline"
              size="xs"
              iconName="CheckCircle"
              iconPosition="left"
              onClick={() => onResolve?.(scan?.id)}
            >
              Mark resolved
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            iconName="ArrowRight"
            iconPosition="right"
            onClick={() => navigate('/scan-results', { state: { scanId: scan?.id } })}
          >
            View details
          </Button>
        </div>
      </div>
    </article>
  );
};

export default RecentScanCard;
