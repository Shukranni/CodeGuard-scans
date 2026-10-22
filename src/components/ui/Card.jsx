/**
 * Card — the surface primitive used across every page.
 *
 *   <Card>
 *     <CardHeader title="…" description="…" actions={…} />
 *     <CardBody>…</CardBody>
 *     <CardFooter>…</CardFooter>
 *   </Card>
 */
import React from 'react';
import { cn } from '../../utils/cn';

export const Card = ({ className, as: Component = 'section', interactive = false, ...props }) => (
  <Component
    className={cn(
      'rounded-xl border border-border bg-card text-card-foreground',
      interactive && 'transition-all duration-150 ease-out hover:border-primary/40 hover:shadow-md',
      className,
    )}
    {...props}
  />
);

export const CardHeader = ({ title, description, actions, icon, className, children, ...props }) => (
  <div
    className={cn(
      'flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5',
      className,
    )}
    {...props}
  >
    <div className="flex min-w-0 items-start gap-3">
      {icon ? (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        {title ? (
          <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        ) : null}
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </div>
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);

export const CardBody = ({ className, ...props }) => (
  <div className={cn('px-4 py-4 md:px-5', className)} {...props} />
);

export const CardFooter = ({ className, ...props }) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 md:px-5',
      className,
    )}
    {...props}
  />
);

export default Card;
