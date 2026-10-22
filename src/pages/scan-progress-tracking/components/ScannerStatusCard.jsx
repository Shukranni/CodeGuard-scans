import React from 'react';
import Icon from '../../../components/AppIcon';

const ScannerStatusCard = ({ scanner }) => {
  const getStatusIcon = () => {
    switch (scanner?.status) {
      case 'completed':
        return { name: 'CheckCircle2', color: 'var(--color-success)' };
      case 'running':
        return { name: 'Loader2', color: 'var(--color-accent)' };
      case 'pending':
        return { name: 'Clock', color: 'var(--color-muted-foreground)' };
      case 'failed':
        return { name: 'XCircle', color: 'var(--color-error)' };
      default:
        return { name: 'Circle', color: 'var(--color-muted-foreground)' };
    }
  };

  const statusIcon = getStatusIcon();

  return (
    <div className="bg-card rounded-lg border border-border p-6 transition-all duration-150 hover:shadow-elevation-2">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon name={scanner?.icon} size={24} color="var(--color-primary)" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{scanner?.name}</h3>
            <p className="text-sm text-muted-foreground">{scanner?.description}</p>
          </div>
        </div>
        <div className={scanner?.status === 'running' ? 'animate-spin' : ''}>
          <Icon name={statusIcon?.name} size={24} color={statusIcon?.color} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium text-foreground">{scanner?.progress}%</span>
        </div>

        <div className="w-full bg-muted rounded-full overflow-hidden h-2">
          <div
            className={`h-full transition-all duration-300 ${
              scanner?.status === 'completed'
                ? 'bg-success'
                : scanner?.status === 'failed' ?'bg-error' :'bg-primary'
            }`}
            style={{ width: `${scanner?.progress}%` }}
          />
        </div>

        {scanner?.currentFile && (
          <div className="mt-3 p-3 bg-muted/50 rounded-md">
            <p className="text-xs text-muted-foreground mb-1">Currently scanning:</p>
            <p className="text-sm font-mono text-foreground truncate">{scanner?.currentFile}</p>
          </div>
        )}

        {scanner?.logs && scanner?.logs?.length > 0 && (
          <div className="mt-3 space-y-1">
            {scanner?.logs?.slice(-3)?.map((log, index) => (
              <div key={index} className="flex items-start gap-2 text-xs">
                <Icon name="ChevronRight" size={12} className="text-muted-foreground mt-0.5" />
                <span className="text-muted-foreground">{log}</span>
              </div>
            ))}
          </div>
        )}

        {scanner?.status === 'failed' && scanner?.error && (
          <div className="mt-3 p-3 bg-error/10 border border-error/20 rounded-md">
            <div className="flex items-start gap-2">
              <Icon name="AlertCircle" size={16} color="var(--color-error)" className="mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-error mb-1">Scan Failed</p>
                <p className="text-xs text-error/80">{scanner?.error}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScannerStatusCard;
