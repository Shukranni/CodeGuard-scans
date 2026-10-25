/**
 * SecuritySection — password-change form + sign-out action.
 *
 * Password change calls POST /api/auth/change-password/ which validates the
 * current password server-side, runs Django's password validators, and returns
 * fresh JWT tokens. replaceTokens() stores the new pair so the user stays
 * signed in after the change.
 *
 * 2FA and Active Sessions are deliberately omitted because they are not
 * implemented in this application.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { useAuth } from '../../../context/AuthContext';
import { useNotification } from '../../../context/NotificationContext';
import { changePassword } from '../../../services/authService';
import { useNavigate } from 'react-router-dom';

// ── Small helper: password-visibility toggle field ────────────────────────────
const PasswordField = ({ id, label, value, onChange, error, autoComplete, placeholder }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder || ''}
          className={`flex h-10 w-full rounded-md border ${
            error ? 'border-destructive' : 'border-input'
          } bg-background pl-3 pr-10 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          <Icon name={visible ? 'EyeOff' : 'Eye'} size={16} />
        </button>
      </div>
      {error && (
        <p className="mt-1 text-sm text-destructive">
          {Array.isArray(error) ? error.join(' ') : error}
        </p>
      )}
    </div>
  );
};

// ── Main section ──────────────────────────────────────────────────────────────
const SecuritySection = () => {
  const { signOut, replaceTokens } = useAuth();
  const { success, error } = useNotification();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();

    // Basic client-side pre-check
    const clientErrors = {};
    if (!form.current_password)  clientErrors.current_password  = 'Current password is required.';
    if (!form.new_password)      clientErrors.new_password      = 'New password is required.';
    if (!form.confirm_password)  clientErrors.confirm_password  = 'Please confirm your new password.';
    if (
      form.new_password &&
      form.confirm_password &&
      form.new_password !== form.confirm_password
    ) {
      clientErrors.confirm_password = 'Passwords do not match.';
    }
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); return; }

    setErrors({});
    setSaving(true);
    setFeedback(null);
    try {
      const { data } = await changePassword(form);
      // Store the fresh tokens so Axios keeps working without re-login
      replaceTokens({ access: data.access, refresh: data.refresh });
      setForm({ current_password: '', new_password: '', confirm_password: '' });
      setFeedback({ type: 'success', msg: 'Password changed successfully.' });
      success('Password updated', 'Your password was changed successfully.');
    } catch (err) {
      const detail = err?.response?.data;
      if (detail && typeof detail === 'object') {
        setErrors(detail);
      } else {
        setFeedback({ type: 'error', msg: 'Failed to change password. Please try again.' });
      }
      error('Password update failed', 'Your password could not be changed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      success('Signed out', 'You have been signed out successfully.');
      navigate('/signin', { replace: true });
    } catch (err) {
      error('Sign out failed', 'We could not sign you out cleanly. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <section aria-labelledby="security-heading">
      <h2 id="security-heading" className="text-lg font-semibold text-foreground mb-1">
        Security
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Manage your password and session.
      </p>

      {/* ── Change password ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Icon name="KeyRound" size={15} className="text-primary" />
          Change password
        </h3>

        <form onSubmit={handleChangePassword} noValidate className="space-y-4">
          <PasswordField
            id="current_password"
            label="Current password"
            value={form.current_password}
            onChange={set('current_password')}
            error={errors.current_password}
            autoComplete="current-password"
            placeholder="Your current password"
          />
          <PasswordField
            id="new_password"
            label="New password"
            value={form.new_password}
            onChange={set('new_password')}
            error={errors.new_password}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
          <PasswordField
            id="confirm_password"
            label="Confirm new password"
            value={form.confirm_password}
            onChange={set('confirm_password')}
            error={errors.confirm_password}
            autoComplete="new-password"
            placeholder="Repeat the new password"
          />

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

          <div className="pt-1">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={saving}
              disabled={saving}
              className="flex items-center gap-2"
            >
              {!saving && <Icon name="Lock" size={15} />}
              <span>{saving ? 'Saving…' : 'Update password'}</span>
            </Button>
          </div>
        </form>
      </div>

      {/* ── Session / sign-out ────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Icon name="LogOut" size={15} className="text-muted-foreground" />
          Current session
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Sign out of this device and clear your local session.
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
          <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </Button>
      </div>
    </section>
  );
};

export default SecuritySection;
