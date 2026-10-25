import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

const SignIn = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const { success, error } = useNotification();

  const from = location.state?.from?.pathname || '/dashboard';

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = () => {
    const newErrors = {};
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address.';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required.';
    }
    return newErrors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear field-level error on change
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
    if (apiError) setApiError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    setApiError('');
    try {
      await signIn(formData.email, formData.password);
      success('Sign in successful', 'Welcome back. Your workspace is ready.');
      navigate(from, { replace: true });
    } catch (err) {
      const detail =
        err.response?.data?.detail ||
        err.response?.data?.non_field_errors?.[0] ||
        'Sign in failed. Please try again.';
      setApiError(detail);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* ── Left brand panel ─────────────────────────────────────────────── */}
      {/* Light mode uses a flat surface + dark text (no gradient) so the
          content stays readable; dark mode keeps the branded gradient. */}
      <div className="hidden lg:flex lg:w-1/2 bg-surface dark:bg-transparent dark:bg-gradient-to-br dark:from-primary/90 dark:to-secondary/80 flex-col justify-between p-12 relative overflow-hidden border-r border-border dark:border-r-0">
        {/* Background pattern */}
        <div className="absolute inset-0">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute border border-foreground/10 dark:border-white/30 rounded-full"
              style={{
                width: `${(i + 1) * 120}px`,
                height: `${(i + 1) * 120}px`,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-primary dark:bg-white/20 rounded-xl flex items-center justify-center text-white">
              <Icon name="Shield" size={24} />
            </div>
            <span className="text-foreground dark:text-white text-xl font-heading font-semibold">
              SecureCodeAnalyzer
            </span>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-4xl font-heading font-bold text-foreground dark:text-white leading-tight">
            Scan. Detect.
            <br />
            <span className="text-muted-foreground dark:text-white/70">Secure.</span>
          </h2>
          <p className="text-muted-foreground dark:text-white/80 text-lg leading-relaxed">
            Find vulnerabilities before attackers do. Powered by Semgrep, Gitleaks, and dependency analysis.
          </p>

          <div className="grid grid-cols-3 gap-4 pt-4">
            {[
              { icon: 'Bug', label: 'Vulnerabilities', value: '10k+' },
              { icon: 'Key', label: 'Secrets Found', value: '500+' },
              { icon: 'Package', label: 'Deps Scanned', value: '50k+' },
            ].map((stat) => (
              <div key={stat.label} className="bg-primary dark:bg-white/10 rounded-xl p-4 text-center backdrop-blur-sm">
                <Icon
                  name={stat.icon}
                  size={20}
                  className="mx-auto mb-2 text-white"
                />
                <div className="text-white font-bold text-lg">{stat.value}</div>
                <div className="text-white/80 dark:text-white/60 text-xs">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-muted-foreground dark:text-white/40 text-xs">
          © {new Date().getFullYear()} SecureCodeAnalyzer
        </div>
      </div>

      {/* ── Right sign-in form ───────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Icon name="Shield" size={24} color="var(--color-primary)" />
            </div>
            <span className="text-xl font-heading font-semibold text-foreground">
              SecureCodeAnalyzer
            </span>
          </div>

          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground">Welcome back</h1>
            <p className="mt-2 text-muted-foreground">
              Sign in to your account to continue scanning.
            </p>
          </div>

          {/* Global API error */}
          {apiError && (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg animate-fade-in">
              <Icon name="AlertCircle" size={18} color="var(--color-destructive)" className="mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">{apiError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Email */}
            <Input
              id="signin-email"
              type="email"
              name="email"
              label="Email address"
              placeholder="you@example.com"
              required
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
              autoComplete="email"
            />

            {/* Password */}
            <div className="space-y-2">
              <label
                htmlFor="signin-password"
                className={`text-sm font-medium leading-none ${errors.password ? 'text-destructive' : 'text-foreground'}`}
              >
                Password <span className="text-destructive ml-1">*</span>
              </label>
              <div className="relative">
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="••••••••"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                  className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    errors.password
                      ? 'border-destructive focus-visible:ring-destructive'
                      : 'border-input'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
            </div>

            <Button
              type="submit"
              fullWidth
              loading={isSubmitting}
              disabled={isSubmitting}
              className="h-11 text-base"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <Link
              to="/signup"
              className="text-primary font-medium hover:underline underline-offset-4"
            >
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
