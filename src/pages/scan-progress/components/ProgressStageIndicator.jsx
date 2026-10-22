/**
 * ProgressStageIndicator — the lifecycle of a scan as a readable timeline.
 *
 * Every stage and every state shown here comes from the server snapshot
 * (queued → preparing → running:<scanner> → terminal); nothing advances on
 * its own and no percentage is invented.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const STAGE_PRESENTATION = {
  pending: {
    label: 'Pending',
    icon: 'Circle',
    badge: 'bg-muted text-muted-foreground border-border',
    marker: 'border-border bg-muted text-muted-foreground',
    title: 'text-muted-foreground',
  },
  active: {
    label: 'Running',
    icon: 'Loader',
    badge: 'bg-primary/10 text-primary border-primary/25',
    marker: 'border-primary/40 bg-primary/10 text-primary',
    title: 'text-foreground',
  },
  completed: {
    label: 'Completed',
    icon: 'CheckCircle2',
    badge: 'bg-success/10 text-success border-success/25',
    marker: 'border-success/30 bg-success/10 text-success',
    title: 'text-foreground',
  },
  skipped: {
    label: 'Skipped',
    icon: 'MinusCircle',
    badge: 'bg-muted text-muted-foreground border-border',
    marker: 'border-border bg-muted text-muted-foreground',
    title: 'text-muted-foreground',
  },
  failed: {
    label: 'Failed',
    icon: 'XCircle',
    badge: 'bg-error/10 text-error border-error/25',
    marker: 'border-error/30 bg-error/10 text-error',
    title: 'text-error',
  },
};

const ProgressStageIndicator = ({ stages = [], overallProgress = 0, statusLabel = '' }) => {
  const progressValue = Math.max(0, Math.min(100, Math.round(overallProgress || 0)));

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Scan progress</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Progress is reported by the scan worker as each scanner finishes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusLabel ? (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {statusLabel}
            </span>
          ) : null}
          <span className="font-heading text-2xl font-bold tabular-nums text-primary">
            {progressValue}%
          </span>
        </div>
      </div>

      <div className="px-4 py-4 md:px-5">
        <div
          className="progress-container"
          role="progressbar"
          aria-valuenow={progressValue}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall scan progress"
        >
          <div className="progress-bar" style={{ width: `${progressValue}%` }} />
        </div>

        {stages.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Waiting for the lifecycle stages reported by the server…
          </p>
        ) : (
          <ol className="mt-5 space-y-2.5">
            {stages.map((stage) => {
              const presentation = STAGE_PRESENTATION[stage?.status] || STAGE_PRESENTATION.pending;
              const isActive = stage?.status === 'active';
              const isDone = stage?.status === 'completed';

              return (
                <li
                  key={stage?.id}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors duration-150',
                    isActive
                      ? 'border-primary/25 bg-primary/5'
                      : 'border-transparent bg-muted/30',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                      presentation.marker,
                    )}
                  >
                    <Icon
                      name={isDone ? 'CheckCircle2' : stage?.status === 'failed' ? 'XCircle' : stage?.icon}
                      size={17}
                      className={isActive ? 'animate-spin' : undefined}
                      aria-hidden="true"
                    />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <h3 className={cn('text-sm font-semibold', presentation.title)}>
                        {stage?.name}
                      </h3>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          presentation.badge,
                        )}
                      >
                        {presentation.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
                      {stage?.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
};

export default ProgressStageIndicator;
