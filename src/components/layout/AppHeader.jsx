/**
 * AppHeader — the persistent top bar of the application shell.
 *
 * Left  : drawer toggle (mobile) + breadcrumbs / current page title
 * Right : page actions, theme switch, account menu
 *
 * The bar is `sticky` rather than `fixed`, so it never overlaps page content
 * and the page can scroll underneath it.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../AppIcon';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';
import { cn } from '../../utils/cn';

const AppHeader = ({
  title,
  breadcrumbs = [],
  actions,
  onMenuToggle,
  className,
}) => {
  return (
    <header className={cn('app-header', className)}>
      {onMenuToggle ? (
        <button
          type="button"
          onClick={onMenuToggle}
          aria-label="Open navigation menu"
          className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Icon name="Menu" size={20} aria-hidden="true" />
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb?.label}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 ? (
                    <Icon name="ChevronRight" size={13} aria-hidden="true" className="text-muted-foreground/70" />
                  ) : null}
                  {crumb?.to ? (
                    <Link
                      to={crumb.to}
                      className="rounded transition-colors hover:text-foreground"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="font-medium text-foreground">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {/*
          The bar repeats the page name for orientation. It is intentionally a
          paragraph, not a heading — each page owns exactly one real `<h1>`
          (see `PageHeader`), which keeps the heading hierarchy clean.
        */}
        {title ? (
          <p className="truncate text-base font-semibold text-foreground md:text-lg">
            {title}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        {actions}
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
};

export default AppHeader;
