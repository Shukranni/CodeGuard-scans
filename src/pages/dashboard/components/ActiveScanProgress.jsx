/**
 * ActiveScanProgress — a compact banner for a scan that is currently running.
 *
 * The numbers come straight from the persisted scan state maintained by
 * `ScanProgressContext`; nothing is simulated.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import StatusBadge from '../../../components/ui/StatusBadge';
import { useScanProgress } from '../../../context/ScanProgressContext';

const ActiveScanProgress = () => {
  const navigate = useNavigate();
  const { scanState, isScanActive } = useScanProgress();

  if (!isScanActive || !scanState) return null;

  const progress = Math.round(scanState?.overallProgress || 0);
  const currentStage = scanState?.stages?.[scanState?.currentStage ?? 0];
  const findings = scanState?.findings?.length || 0;

  return (
    <section
      aria-label="Active scan"
      className="rounded-xl border border-primary/30 bg-primary/5 p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Activity" size={19} aria-hidden="true" className="animate-pulse" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Scan in progress</h2>
              <StatusBadge status="running" size="xs" />
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {scanState?.projectName || 'New project'}
              {currentStage?.name ? ` · ${currentStage.name}` : ''}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          iconName="Eye"
          iconPosition="left"
          onClick={() => navigate('/scan-progress', { state: { scanId: scanState?.id } })}
        >
          View progress
        </Button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Overall progress</span>
          <span className="font-semibold tabular-nums text-primary">{progress}%</span>
        </div>
        <div
          className="progress-container mt-1.5"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Overall scan progress"
        >
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </section>
  );
};

export default ActiveScanProgress;
