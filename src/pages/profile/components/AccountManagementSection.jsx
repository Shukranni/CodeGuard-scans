/**
 * AccountManagementSection — sign-out and account information.
 *
 * Account deletion is NOT implemented in the backend, so no delete button
 * is rendered. Only the sign-out action (which is fully implemented) is
 * shown here.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { useAuth } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const AccountManagementSection = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/signin', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const memberSince = user?.date_joined
    ? new Date(user.date_joined).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <section aria-labelledby="account-heading">
      <h2 id="account-heading" className="text-lg font-semibold text-foreground mb-1">
        Account Management
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Manage your session and account details.
      </p>

      {/* Account overview */}
      <div className="rounded-lg border border-border p-5 mb-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Icon name="Info" size={15} className="text-muted-foreground" />
          Account information
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="w-32 text-muted-foreground flex-shrink-0">Email</dt>
            <dd className="text-foreground font-medium truncate">{user?.email}</dd>
          </div>
          {memberSince && (
            <div className="flex items-center gap-2">
              <dt className="w-32 text-muted-foreground flex-shrink-0">Member since</dt>
              <dd className="text-foreground">{memberSince}</dd>
            </div>
          )}
          <div className="flex items-center gap-2">
            <dt className="w-32 text-muted-foreground flex-shrink-0">Account status</dt>
            <dd className="flex items-center gap-1.5 text-success">
              <Icon name="CheckCircle" size={13} />
              Active
            </dd>
          </div>
        </dl>
      </div>

      {/* Sign out */}
      <div className="rounded-lg border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Icon name="LogOut" size={15} className="text-muted-foreground" />
          Sign out
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          End your current session. You will need to sign in again to access CodeGuard.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          loading={signingOut}
          disabled={signingOut}
          className="flex items-center gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive/60"
        >
          {!signingOut && <Icon name="LogOut" size={15} />}
          <span>{signingOut ? 'Signing out…' : 'Sign out of CodeGuard'}</span>
        </Button>
      </div>
    </section>
  );
};

export default AccountManagementSection;
