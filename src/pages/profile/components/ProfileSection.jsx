/**
 * ProfileSection — editable profile panel.
 *
 * Loads first_name / last_name from the AuthContext user and PATCHes
 * /api/auth/me/ on save. Updates context on success so the header reflects
 * the new name immediately without a page reload.
 */
import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { useAuth } from '../../../context/AuthContext';
import { updateMe } from '../../../services/authService';

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ firstName, lastName, email, size = 'lg' }) => {
  const initials = (() => {
    if (firstName) return (firstName[0] + (lastName?.[0] || '')).toUpperCase();
    return (email?.[0] || '?').toUpperCase();
  })();

  const sizeClasses = size === 'lg'
    ? 'w-16 h-16 text-xl'
    : 'w-10 h-10 text-sm';

  return (
    <div
      className={`${sizeClasses} rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0 font-semibold text-white select-none`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
};

// ── Section ───────────────────────────────────────────────────────────────────
const ProfileSection = () => {
  const { user, updateUser } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [errors,    setErrors]    = useState({});
  const [saving,    setSaving]    = useState(false);
  const [feedback,  setFeedback]  = useState(null); // { type: 'success'|'error', msg }

  // Sync form from context whenever user changes
  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name  || '');
    }
  }, [user]);

  const isDirty =
    firstName !== (user?.first_name || '') ||
    lastName  !== (user?.last_name  || '');

  const validate = () => {
    const errs = {};
    if (!firstName.trim()) errs.first_name = 'First name is required.';
    return errs;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    setFeedback(null);
    try {
      const { data } = await updateMe({
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
      });
      updateUser(data);
      setFeedback({ type: 'success', msg: 'Profile updated successfully.' });
    } catch (err) {
      const detail = err?.response?.data;
      if (detail && typeof detail === 'object') {
        setErrors(detail);
      } else {
        setFeedback({ type: 'error', msg: 'Failed to save changes. Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setFirstName(user?.first_name || '');
    setLastName(user?.last_name   || '');
    setErrors({});
    setFeedback(null);
  };

  const memberSince = user?.date_joined
    ? new Date(user.date_joined).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <section aria-labelledby="profile-heading">
      {/* ── Header ── */}
      <div className="flex items-start gap-4 pb-6 border-b border-border mb-6">
        <Avatar firstName={user?.first_name} lastName={user?.last_name} email={user?.email} />
        <div className="min-w-0">
          <h2
            id="profile-heading"
            className="text-lg font-semibold text-foreground leading-tight"
          >
            {user?.first_name
              ? `${user.first_name} ${user.last_name || ''}`.trim()
              : user?.email}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{user?.email}</p>
          {memberSince && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Icon name="Calendar" size={12} />
              Member since {memberSince}
            </p>
          )}
        </div>
      </div>

      {/* ── Form ── */}
      <form onSubmit={handleSave} noValidate>
        <div className="space-y-5">

          {/* Read-only email */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Email address
            </label>
            <div className="flex h-10 items-center px-3 rounded-md border border-border bg-muted/40 text-sm text-muted-foreground select-all">
              {user?.email}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Email cannot be changed.
            </p>
          </div>

          {/* First name */}
          <div>
            <label
              htmlFor="first_name"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              First name <span className="text-destructive">*</span>
            </label>
            <input
              id="first_name"
              type="text"
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); setErrors((p) => ({ ...p, first_name: undefined })); }}
              className={`flex h-10 w-full rounded-md border ${errors.first_name ? 'border-destructive' : 'border-input'} bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`}
              placeholder="First name"
              required
              autoComplete="given-name"
            />
            {errors.first_name && (
              <p className="mt-1 text-sm text-destructive">{errors.first_name}</p>
            )}
          </div>

          {/* Last name */}
          <div>
            <label
              htmlFor="last_name"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Last name
            </label>
            <input
              id="last_name"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Last name"
              autoComplete="family-name"
            />
          </div>

          {/* Feedback */}
          {feedback && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm ${
                feedback.type === 'success'
                  ? 'bg-success/10 text-success border border-success/20'
                  : 'bg-destructive/10 text-destructive border border-destructive/20'
              }`}
            >
              <Icon
                name={feedback.type === 'success' ? 'CheckCircle' : 'AlertCircle'}
                size={16}
              />
              {feedback.msg}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={saving}
              disabled={saving || !isDirty}
              className="flex items-center gap-2"
            >
              {!saving && <Icon name="Save" size={15} />}
              <span>{saving ? 'Saving…' : 'Save changes'}</span>
            </Button>
            {isDirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={saving}
              >
                Discard
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
};

export default ProfileSection;
