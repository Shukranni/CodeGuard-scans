/**
 * Alert — an inline, dismissible message.
 *
 * The icon, the tone and the visible label all carry the same meaning, so an
 * alert is never communicated by colour alone. `role="alert"` is used for
 * error/warning tones so assistive tech announces them promptly; softer
 * tones use `role="status"`.
 */
import React from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const TONES = {
  info: {
    container: 'border-accent/30 bg-accent/5',
    icon: 'text-accent',
    iconName: 'Info',
  },
  success: {
    container: 'border-success/30 bg-success/5',
    icon: 'text-success',
    iconName: 'CheckCircle2',
  },
  warning: {
    container: 'border-warning/30 bg-warning/5',
    icon: 'text-warning',
    iconName: 'AlertTriangle',
  },
  error: {
    container: 'border-error/30 bg-error/5',
    icon: 'text-error',
    iconName: 'AlertCircle',
  },
};

const Alert = ({
  variant = 'info',
  title,
  children,
  icon,
  onDismiss,
  action,
  className,
}) => {
  const tone = TONES[variant] || TONES.info;
  const isUrgent = variant === 'error' || variant === 'warning';

  return (
    <div
      role={isUrgent ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3',
        tone.container,
        className,
      )}
    >
      <Icon
        name={icon || tone.iconName}
        size={18}
        className={cn('mt-0.5 shrink-0', tone.icon)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title ? (
          <p className={cn('text-sm font-semibold', tone.icon)}>{title}</p>
        ) : null}
        {children ? (
          <div className={cn('text-sm text-muted-foreground', title && 'mt-1')}>
            {children}
          </div>
        ) : null}
        {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="X" size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
};

export default Alert;
