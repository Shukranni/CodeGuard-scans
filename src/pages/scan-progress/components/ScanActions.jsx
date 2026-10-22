/**
 * ScanActions — the actions available for the current lifecycle state.
 *
 * Only real capabilities are exposed: the backend has no pause/cancel/priority
 * API, so those (previously fake) controls are not shown.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const ScanActions = ({ snapshot, isTerminal, isSuccessTerminal, onViewResults, onNewScan }) => {
  const navigate = useNavigate();
  const canViewResults = !!snapshot?.has_results;

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4 md:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name="MousePointerClick" size={17} aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold text-foreground">Actions</h2>
      </div>

      <div className="space-y-2.5 px-4 py-4 md:px-5">
        {isSuccessTerminal ? (
          <Button
            variant="default"
            fullWidth
            onClick={onViewResults}
            disabled={!canViewResults}
            iconName="FileSearch"
            iconPosition="left"
          >
            View results
          </Button>
        ) : null}

        <Button
          variant="outline"
          fullWidth
          onClick={onNewScan}
          iconName="Plus"
          iconPosition="left"
        >
          Start a new scan
        </Button>

        <Button
          variant="ghost"
          fullWidth
          onClick={() => navigate('/dashboard')}
          iconName="LayoutDashboard"
          iconPosition="left"
        >
          Back to dashboard
        </Button>

        {!isTerminal ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
            <Icon name="Info" size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              This scan runs on the server in the background. You can safely leave this page or
              refresh — progress resumes where it left off.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default ScanActions;
