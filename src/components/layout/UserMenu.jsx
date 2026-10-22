/**
 * UserMenu — the account menu in the app header.
 *
 * Shows the signed-in user's identity, links to the account settings page and
 * signs the user out. The sign-out action confirms before it runs so a stray
 * click cannot end a session.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import Dropdown from '../ui/Dropdown';
import useSignOut from './useSignOut';
import SignOutConfirmDialog from './SignOutConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../utils/cn';

export const getInitials = (user) => {
  if (!user) return '?';
  if (user.first_name) {
    return `${user.first_name[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase();
  }
  const emailName = user.email?.split('@')[0] || '';
  return (emailName.slice(0, 2) || '?').toUpperCase();
};

const UserMenu = ({ className }) => {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const {
    confirmOpen,
    openConfirm,
    closeConfirm,
    signingOut,
    confirmSignOut,
  } = useSignOut();

  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    user?.email?.split('@')[0] ||
    'Account';

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={() => navigate('/signin')}
        className={cn(
          'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          className,
        )}
      >
        Sign in
      </button>
    );
  }

  return (
    <>
      <Dropdown
        align="right"
        label="Account menu"
        trigger={
          <span className="inline-flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-muted md:pr-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {getInitials(user)}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm font-medium text-foreground lg:inline">
              {displayName}
            </span>
            <Icon name="ChevronDown" size={14} className="hidden text-muted-foreground lg:inline" />
          </span>
        }
        items={[
          {
            key: 'account',
            label: 'Account settings',
            description: user?.email || '',
            icon: 'UserCog',
            onSelect: () => navigate('/profile'),
          },
          {
            key: 'new-scan',
            label: 'Start a new scan',
            icon: 'Plus',
            onSelect: () => navigate('/new-scan-setup'),
          },
          { key: 'sep-1', type: 'separator' },
          {
            key: 'signout',
            label: 'Sign out',
            icon: 'LogOut',
            danger: true,
            onSelect: openConfirm,
          },
        ]}
      />

      <SignOutConfirmDialog
        isOpen={confirmOpen}
        onClose={closeConfirm}
        onConfirm={confirmSignOut}
        loading={signingOut}
      />
    </>
  );
};

export default UserMenu;
