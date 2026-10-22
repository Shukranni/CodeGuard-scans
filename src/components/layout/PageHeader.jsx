/**
 * PageHeader — the title block that opens every page.
 *
 * Renders the page's single `<h1>`, an optional supporting description and an
 * optional row of actions. It is sticky-friendly: pages that need a compact
 * bar use the breadcrumb row in `AppHeader` instead.
 */
import React from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const PageHeader = ({
  title,
  description,
  actions,
  eyebrow,
  className,
  children,
}) => (
  <div
    className={cn(
      'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
      className,
    )}
  >
    <div className="min-w-0">
      {eyebrow ? (
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground md:text-[0.9375rem]">
          {description}
        </p>
      ) : null}
      {children}
    </div>

    {actions ? (
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    ) : null}
  </div>
);

/**
 * SectionHeading — a secondary heading inside a page, used to title a card or
 * a region without competing with the page `<h1>`.
 */
export const SectionHeading = ({ title, description, icon, actions, className }) => (
  <div className={cn('flex items-start justify-between gap-3', className)}>
    <div className="flex min-w-0 items-start gap-2.5">
      {icon ? (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} size={15} aria-hidden="true" />
        </span>
      ) : null}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);

export default PageHeader;
