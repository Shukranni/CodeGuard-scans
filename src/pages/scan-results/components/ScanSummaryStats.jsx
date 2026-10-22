/**
 * ScanSummaryStats — the headline numbers of a scan.
 *
 * Every value is taken from the API payload (or derived from it); nothing is
 * estimated. `filesAffected` is the number of files that contain at least one
 * finding; `filesScanned` (the archive file count reported by the worker) is
 * shown separately on the page.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const ScanSummaryStats = ({ stats }) => {
  const statCards = [
    {
      label: 'Total findings',
      value: stats?.totalFindings ?? 0,
      icon: 'FileSearch',
      tone: 'text-primary',
      surface: 'bg-primary/10',
    },
    {
      label: 'Critical',
      value: stats?.critical ?? 0,
      icon: 'OctagonAlert',
      tone: 'text-critical',
      surface: 'bg-critical/10',
    },
    {
      label: 'High',
      value: stats?.high ?? 0,
      icon: 'AlertTriangle',
      tone: 'text-high',
      surface: 'bg-high/10',
    },
    {
      label: 'Medium',
      value: stats?.medium ?? 0,
      icon: 'AlertCircle',
      tone: 'text-medium',
      surface: 'bg-medium/10',
    },
    {
      label: 'Low',
      value: stats?.low ?? 0,
      icon: 'Info',
      tone: 'text-low',
      surface: 'bg-low/10',
    },
    {
      label: 'Files affected',
      value: stats?.filesAffected ?? 0,
      icon: 'FileCode',
      tone: 'text-secondary',
      surface: 'bg-secondary/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {statCards.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-border bg-card p-3.5 md:p-4"
        >
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                stat.surface,
                stat.tone,
              )}
            >
              <Icon name={stat.icon} size={17} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{stat.label}</p>
              <p className="font-heading text-xl font-bold tabular-nums text-foreground md:text-2xl">
                {stat.value}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ScanSummaryStats;
