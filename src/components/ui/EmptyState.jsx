/**
 * EmptyState — a calm, actionable placeholder for "there is nothing here yet".
 *
 * It is deliberately explicit that no data exists (rather than showing a
 * zero-filled chart), and always offers the next meaningful action.
 */
import React from 'react';
import Icon from '../AppIcon';
import Button from './Button';
import { cn } from '../../utils/cn';

const EmptyState = ({
  icon = 'Inbox',
  title,
  description,
  actionLabel,
  onAction,
  actionIcon = 'Plus',
  secondaryAction,
  className,
  compact = false,
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 text-center',
      compact ? 'px-5 py-8' : 'px-6 py-14',
      className,
    )}
  >
    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <Icon name={icon} size={26} aria-hidden="true" />
    </span>
    {title ? <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3> : null}
    {description ? (
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
    ) : null}
    {actionLabel ? (
      <Button
        className="mt-5"
        iconName={actionIcon}
        iconPosition="left"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    ) : null}
    {secondaryAction}
  </div>
);

export default EmptyState;
