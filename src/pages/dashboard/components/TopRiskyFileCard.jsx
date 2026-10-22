/**
 * TopRiskyFileCard — one of the files with the highest weighted risk.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import SeverityBadge from '../../../components/ui/SeverityBadge';
import { cn } from '../../../utils/cn';

const TopRiskyFileCard = ({ file }) => {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate('/file-tree-explorer', { state: { filePath: file?.path } })}
      className="group flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors duration-150 hover:border-primary/40 hover:bg-muted/30"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon name="FileCode" size={17} aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
            {file?.name}
          </span>
          <SeverityBadge severity={file?.severity} size="xs" />
        </span>

        <span className="mt-1 block truncate font-data text-xs text-muted-foreground">
          {file?.path}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Icon name="AlertTriangle" size={12} aria-hidden="true" />
            {file?.vulnerabilities ?? 0} {file?.vulnerabilities === 1 ? 'issue' : 'issues'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="Gauge" size={12} aria-hidden="true" />
            Risk {file?.riskScore ?? 0}
          </span>
        </span>
      </span>

      <Icon
        name="ChevronRight"
        size={18}
        className="mt-2 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
};

export default TopRiskyFileCard;
