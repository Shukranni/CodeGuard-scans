import React, { useEffect, useState } from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import { cn } from '../../utils/cn';

const typeStyles = {
  success: {
    container: 'border-success/30 bg-success/5',
    icon: 'text-success',
    iconName: 'CheckCircle2',
  },
  error: {
    container: 'border-error/30 bg-error/5',
    icon: 'text-error',
    iconName: 'AlertCircle',
  },
  warning: {
    container: 'border-warning/30 bg-warning/5',
    icon: 'text-warning',
    iconName: 'AlertTriangle',
  },
  info: {
    container: 'border-accent/30 bg-accent/5',
    icon: 'text-accent',
    iconName: 'Info',
  },
};

const NotificationItem = ({ notification, onDismiss }) => {
  const [expanded, setExpanded] = useState(false);
  const tone = typeStyles[notification.type] || typeStyles.info;

  useEffect(() => {
    if (!notification.duration || notification.duration <= 0) return undefined;
    const timer = window.setTimeout(() => onDismiss(notification.id), notification.duration);
    return () => window.clearTimeout(timer);
  }, [notification.duration, notification.id, onDismiss]);

  return (
    <div
      className={cn(
        'w-full max-w-sm rounded-xl border bg-background/90 p-3 shadow-elevation-2 backdrop-blur-sm animate-slide-in',
        tone.container,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 shrink-0', tone.icon)}>
          <Icon name={tone.iconName} size={18} aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('text-sm font-semibold', tone.icon)}>{notification.title}</p>
            <button
              type="button"
              onClick={() => onDismiss(notification.id)}
              className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <Icon name="X" size={14} aria-hidden="true" />
            </button>
          </div>

          <p className="mt-1 text-sm text-foreground/90">{notification.message}</p>

          {notification.action ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant={notification.type === 'error' ? 'outline' : 'secondary'}
                onClick={() => {
                  notification.action.onClick?.();
                  if (notification.action.dismissOnClick !== false) onDismiss(notification.id);
                }}
              >
                {notification.action.label}
              </Button>
            </div>
          ) : null}

          {notification.details ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                {expanded ? 'Hide details' : 'View details'}
              </button>
              {expanded ? (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background/70 p-2 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
                  {notification.details}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default NotificationItem;
