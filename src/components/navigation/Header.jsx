/**
 * Header — backwards-compatible entry point for the application header.
 *
 * The header now lives in `src/components/layout/AppHeader.jsx` and is
 * normally rendered by `AppShell`. This wrapper keeps the historic import path
 * (`components/navigation/Header`) working for any page that has not been
 * migrated to the shell yet.
 */
import React from 'react';
import AppHeader from '../layout/AppHeader';

const Header = ({ title, breadcrumbs, actions, className }) => (
  <AppHeader
    title={title}
    breadcrumbs={breadcrumbs}
    actions={actions}
    className={className}
  />
);

export default Header;
