/**
 * StatusBadge — lifecycle status for scans, scanners and workers.
 *
 * Like the severity badge this never relies on colour alone: every state has
 * a label and a glyph.
 *
 * States
 *   pending   grey    · queued    teal
 *   running   teal    · completed emerald
 *   failed    red     · resolved  emerald (outline)
 *   warning   amber   · info      blue
 */
import React from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   icon: 'Circle',        classes: 'bg-muted text-muted-foreground border-border' },
  queued:    { label: 'Queued',    icon: 'Clock',         classes: 'bg-primary/10 text-primary border-primary/25' },
  preparing: { label: 'Preparing', icon: 'Settings',      classes: 'bg-primary/10 text-primary border-primary/25' },
  running:   { label: 'Running',   icon: 'Loader',        classes: 'bg-primary/10 text-primary border-primary/25' },
  active:    { label: 'Active',    icon: 'Activity',      classes: 'bg-primary/10 text-primary border-primary/25' },
  completed: { label: 'Completed', icon: 'CheckCircle',   classes: 'bg-success/10 text-success border-success/25' },
  success:   { label: 'Success',   icon: 'CheckCircle',   classes: 'bg-success/10 text-success border-success/25' },
  completed_with_warnings: {
    label: 'Completed with warnings',
    icon: 'AlertTriangle',
    classes: 'bg-warning/10 text-warning border-warning/25',
  },
  resolved:  { label: 'Resolved',  icon: 'ShieldCheck',   classes: 'bg-success/10 text-success border-success/25' },
  skipped:   { label: 'Skipped',   icon: 'MinusCircle',   classes: 'bg-muted text-muted-foreground border-border' },
  warning:   { label: 'Warning',   icon: 'AlertTriangle', classes: 'bg-warning/10 text-warning border-warning/25' },
  failed:    { label: 'Failed',    icon: 'XCircle',       classes: 'bg-error/10 text-error border-error/25' },
  error:     { label: 'Error',     icon: 'XCircle',       classes: 'bg-error/10 text-error border-error/25' },
  info:      { label: 'Info',      icon: 'Info',          classes: 'bg-accent/10 text-accent border-accent/25' },
  offline:   { label: 'Offline',   icon: 'ServerOff',     classes: 'bg-warning/10 text-warning border-warning/25' },
  online:    { label: 'Online',    icon: 'Server',        classes: 'bg-success/10 text-success border-success/25' },
  neutral:   { label: 'Neutral',   icon: 'Circle',        classes: 'bg-muted text-muted-foreground border-border' },
};

const DEFAULT_STATUS = {
  label: 'Unknown',
  icon: 'Circle',
  classes: 'bg-muted text-muted-foreground border-border',
};

export const getStatusConfig = (status) => {
  const key = String(status || '').toLowerCase().trim();
  return STATUS_CONFIG[key] || { ...DEFAULT_STATUS, label: key ? key : DEFAULT_STATUS.label };
};

const SIZE_CLASSES = {
  xs: 'px-1.5 py-0.5 text-[11px] gap-1',
  sm: 'px-2 py-0.5 text-xs gap-1',
  default: 'px-2.5 py-0.5 text-xs gap-1.5',
  lg: 'px-3 py-1 text-sm gap-1.5',
};

const ICON_SIZE = {
  xs: 10,
  sm: 12,
  default: 12,
  lg: 16,
};

const SPINNING = new Set(['running']);

const StatusBadge = ({ status, size = 'default', showIcon = true, label, className }) => {
  const config = getStatusConfig(status);
  const text = label || config.label;

  return (
    <span
      className={cn('status-badge border', config.classes, SIZE_CLASSES[size], className)}
    >
      {showIcon && (
        <Icon
          name={config.icon}
          size={ICON_SIZE[size]}
          className={SPINNING.has(String(status || '').toLowerCase()) ? 'animate-spin' : undefined}
          aria-hidden="true"
        />
      )}
      <span>{text}</span>
    </span>
  );
};

export default StatusBadge;
