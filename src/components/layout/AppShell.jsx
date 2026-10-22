/**
 * AppShell — the frame every signed-in page renders inside.
 *
 * It owns the responsive drawer state, the sticky header and the main content
 * region. Pages supply their own content; the shell provides the chrome.
 */
import React, { useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import AppHeader from './AppHeader';
import { cn } from '../../utils/cn';

const AppShell = ({
  children,
  headerTitle,
  breadcrumbs,
  headerActions,
  contentClassName,
  className,
  flush = false,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className={cn('app-shell', className)}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[1100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <Sidebar isOpen={drawerOpen} onClose={closeDrawer} />

      <div className="app-main">
        <AppHeader
          title={headerTitle}
          breadcrumbs={breadcrumbs}
          actions={headerActions}
          onMenuToggle={openDrawer}
        />
        <main
          id="main-content"
          className={flush ? cn('app-content-flush', contentClassName) : cn('app-content', contentClassName)}
        >
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppShell;
