/**
 * Sidebar — the primary application navigation.
 *
 * On large screens it is a permanent rail. On small screens it becomes an
 * off-canvas drawer: the backdrop and the close button both dismiss it, the
 * Escape key dismisses it, and it closes automatically after a navigation.
 */
import React, { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import Button from '../ui/Button';
import { NAV_SECTIONS, PRODUCT_NAME, PRODUCT_TAGLINE } from './navConfig';
import { useAuth } from '../../context/AuthContext';
import useSignOut from './useSignOut';
import SignOutConfirmDialog from './SignOutConfirmDialog';
import { cn } from '../../utils/cn';

const NavItem = ({ item, onNavigate }) => (
  <NavLink
    to={item.to}
    end={item.end}
    onClick={onNavigate}
    className={({ isActive }) =>
      cn('nav-item', isActive && 'is-active')
    }
  >
    {({ isActive }) => (
      <>
        <Icon name={item.icon} size={17} className="nav-item-icon" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
        {isActive ? <span className="sr-only">(current page)</span> : null}
      </>
    )}
  </NavLink>
);

const Sidebar = ({ isOpen = false, onClose }) => {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const {
    confirmOpen,
    openConfirm,
    closeConfirm,
    signingOut,
    confirmSignOut,
  } = useSignOut({ onSignedOut: onClose });

  // Close the drawer whenever the route changes.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (event) => {
      // The sign-out dialog owns Escape while it is open — it dismisses the
      // dialog and leaves the drawer untouched.
      if (event.key === 'Escape' && !confirmOpen) onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, confirmOpen]);

  return (
    <>
      {isOpen ? (
        <div
          className="app-sidebar-backdrop"
          onClick={onClose}
          role="presentation"
          aria-hidden="true"
        />
      ) : null}

      <aside
        id="app-sidebar"
        className={cn('app-sidebar flex flex-col', isOpen && 'is-open')}
        aria-label="Primary"
      >
        {/* ── Brand ─────────────────────────────────────────────────────── */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
          <Link
            to="/dashboard"
            onClick={onClose}
            className="flex min-w-0 items-center gap-2.5 rounded-lg"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Icon name="ShieldCheck" size={19} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight text-foreground">
                {PRODUCT_NAME}
              </span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                {PRODUCT_TAGLINE}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Icon name="X" size={18} aria-hidden="true" />
          </button>
        </div>

        {/* ── Primary action ────────────────────────────────────────────── */}
        <div className="px-3 pt-4">
          <Button
            asChild
            fullWidth
            iconName="Plus"
            iconPosition="left"
            className="justify-center"
          >
            <Link to="/new-scan-setup" onClick={onClose}>
              New Scan
            </Link>
          </Button>
        </div>

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id}>
              <p className="nav-section-label">{section.label}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavItem item={item} onNavigate={onClose} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border px-3 py-3">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={openConfirm}
              className="nav-item w-full hover:text-error"
            >
              <Icon name="LogOut" size={17} className="nav-item-icon" aria-hidden="true" />
              <span className="truncate">Sign out</span>
            </button>
          ) : null}
          <p className="mt-2 px-3 text-[11px] leading-relaxed text-muted-foreground">
            Static analysis with Semgrep, Gitleaks and dependency auditing.
          </p>
        </div>
      </aside>

      <SignOutConfirmDialog
        isOpen={confirmOpen}
        onClose={closeConfirm}
        onConfirm={confirmSignOut}
        loading={signingOut}
      />
    </>
  );
};

export default Sidebar;
