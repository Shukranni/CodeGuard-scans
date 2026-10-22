/**
 * Skeleton — loading placeholders.
 *
 * They mirror the shape of the content that is being loaded so the layout
 * does not jump when the data arrives.
 */
import React from 'react';
import { cn } from '../../utils/cn';

export const Skeleton = ({ className, ...props }) => (
  <div className={cn('skeleton', className)} aria-hidden="true" {...props} />
);

export const SkeletonText = ({ lines = 3, className }) => (
  <div className={cn('space-y-2', className)} aria-hidden="true">
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton
        key={index}
        className={cn('h-3.5 w-full', index === lines - 1 ? 'w-2/3' : '')}
      />
    ))}
  </div>
);

/** A rectangular skeleton approximating a stat card. */
export const SkeletonCard = ({ className }) => (
  <div
    className={cn('rounded-xl border border-border bg-card p-4 md:p-5', className)}
    aria-hidden="true"
  >
    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-9 w-9 rounded-lg" />
      <Skeleton className="h-3 w-12" />
    </div>
    <Skeleton className="mt-4 h-3 w-24" />
    <Skeleton className="mt-2 h-7 w-16" />
  </div>
);

/** A list of skeleton rows. */
export const SkeletonList = ({ rows = 3, className }) => (
  <div className={cn('space-y-3', className)} aria-hidden="true">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-2.5 h-3 w-2/3" />
      </div>
    ))}
  </div>
);

/**
 * LoadingRegion — wraps skeletons with an accessible live region so screen
 * readers announce that content is loading.
 */
export const LoadingRegion = ({ label = 'Loading…', children, className }) => (
  <div role="status" aria-live="polite" aria-busy="true" className={className}>
    <span className="sr-only">{label}</span>
    {children}
  </div>
);

export default Skeleton;
