/**
 * ErrorState — a recoverable error surface.
 *
 * The message is always the one the API/backend produced (or a precise
 * description of what failed); this component never invents copy.
 */
import React from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import { cn } from '../../utils/cn';

const ErrorState = ({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  action,
  icon = 'AlertTriangle',
  variant = 'error',
  className,
  compact = false,
}) => {
  const isWarning = variant === 'warning';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border text-center',
        compact ? 'px-5 py-8' : 'px-6 py-12',
        isWarning
          ? 'border-warning/30 bg-warning/5'
          : 'border-error/30 bg-error/5',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-2xl',
          isWarning ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error',
        )}
      >
        <Icon name={icon} size={26} aria-hidden="true" />
      </span>
      {title ? (
        <h3 className={cn('mt-4 text-base font-semibold', isWarning ? 'text-warning' : 'text-error')}>
          {title}
        </h3>
      ) : null}
      {message ? (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground break-words">{message}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          <Button variant="outline" iconName="RefreshCw" iconPosition="left" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
};

export default ErrorState;
