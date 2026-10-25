import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

const SignUp = () => {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const { success, error } = useNotification();

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm_password: '',
  });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // ── Password strength indicator ──────────────────────────────────────────
  const getPasswordStrength = (pwd) => {
    if (!pwd) return { score: 0, label: '', color: '' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    if (score <= 1) return { score, label: 'Very weak', color: 'bg-destructive' };
    if (score === 2) return { score, label: 'Weak', color: 'bg-warning' };
    if (score === 3) return { score, label: 'Fair', color: 'bg-accent' };
    if (score === 4) return { score, label: 'Strong', color: 'bg-success' };
    return { score, label: 'Very strong', color: 'bg-success' };
  };
  const strength = getPasswordStrength(formData.password);

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = () => {
    const newErrors = {};
    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required.';
    }
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address.';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required.';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters.';
    }
    if (!formData.confirm_password) {
      newErrors.confirm_password = 'Please confirm your password.';
    } else if (formData.password !== formData.confirm_password) {
      newErrors.confirm_password = 'Passwords do not match.';
    }
    return newErrors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
    if (apiError) setApiError('');
  };

  // ── Parse DRF validation errors ──────────────────────────────────────────
  const parseApiErrors = (data) => {
    const fieldErrors = {};
    let general = '';
    Object.entries(data || {}).forEach(([key, val]) => {
      const msg = Array.isArray(val) ? val[0] : val;
      if (['first_name', 'last_name', 'email', 'password', 'confirm_password'].includes(key)) {
        fieldErrors[key] = msg;
      } else {
        general = msg;
      }
    });
    return { fieldErrors, general };
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
      await signUp(formData);
      success('Account created', 'Your account is ready. You are now signed in.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err.response?.data) {
        const { fieldErrors, general } = parseApiErrors(err.response.data);
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        if (general) setApiError(general);
        if (!general && Object.keys(fieldErrors).length === 0) {
          setApiError('Registration failed. Please try again.');
        }
        error('Account creation failed', general || 'Registration failed. Please try again.');
      } else {
        setApiError('Registration failed. Please check your connection and try again.');
        error('Account creation failed', 'Registration failed. Please check your connection and try again.');
      }
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
            Start securing
            <br />
            <span className="text-muted-foreground dark:text-white/70">your code today.</span>
          </h2>
          <p className="text-muted-foreground dark:text-white/80 text-lg leading-relaxed">
            Join thousands of developers and security engineers who trust SecureCodeAnalyzer to protect their applications.
          </p>

          <div className="space-y-3">
            {[
              { icon: 'CheckCircle', text: 'Free to get started' },
              { icon: 'CheckCircle', text: 'Scan unlimited projects' },
              { icon: 'CheckCircle', text: 'Semgrep + Gitleaks + dependency analysis' },
              { icon: 'CheckCircle', text: 'No credit card required' },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-3">
                <Icon name={item.icon} size={18} className="text-foreground dark:text-white" />
                <span className="text-muted-foreground dark:text-white/80 text-sm">{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-muted-foreground dark:text-white/40 text-xs">
          © {new Date().getFullYear()} SecureCodeAnalyzer
        </div>
      </div>

      {/* ── Right sign-up form ───────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-md space-y-6 py-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Icon name="Shield" size={24} color="var(--color-primary)" />
            </div>
            <span className="text-xl font-heading font-semibold text-foreground">
              SecureCodeAnalyzer
            </span>
          </div>

          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground">Create an account</h1>
            <p className="mt-2 text-muted-foreground">
              Get started — it's free.
            </p>
          </div>

          {/* Global API error */}
          {apiError && (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg animate-fade-in">
              <Icon name="AlertCircle" size={18} color="var(--color-destructive)" className="mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">{apiError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="signup-first-name"
                type="text"
                name="first_name"
                label="First name"
                placeholder="Jane"
                required
                value={formData.first_name}
                onChange={handleChange}
                error={errors.first_name}
                autoComplete="given-name"
              />
              <Input
                id="signup-last-name"
                type="text"
                name="last_name"
                label="Last name"
                placeholder="Doe"
                value={formData.last_name}
                onChange={handleChange}
                error={errors.last_name}
                autoComplete="family-name"
              />
            </div>

            {/* Email */}
            <Input
              id="signup-email"
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
                htmlFor="signup-password"
                className={`text-sm font-medium leading-none ${errors.password ? 'text-destructive' : 'text-foreground'}`}
              >
                Password <span className="text-destructive ml-1">*</span>
              </label>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="Min. 8 characters"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="new-password"
                  className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    errors.password ? 'border-destructive focus-visible:ring-destructive' : 'border-input'
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
              {/* Password strength meter */}
              {formData.password && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <div
                        key={s}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          strength.score >= s ? strength.color : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{strength.label}</p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <label
                htmlFor="signup-confirm-password"
                className={`text-sm font-medium leading-none ${errors.confirm_password ? 'text-destructive' : 'text-foreground'}`}
              >
                Confirm password <span className="text-destructive ml-1">*</span>
              </label>
              <div className="relative">
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirm_password"
                  placeholder="Repeat your password"
                  required
                  value={formData.confirm_password}
                  onChange={handleChange}
                  autoComplete="new-password"
                  className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    errors.confirm_password ? 'border-destructive focus-visible:ring-destructive' : 'border-input'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showConfirmPassword ? 'EyeOff' : 'Eye'} size={16} />
                </button>
              </div>
              {errors.confirm_password && (
                <p className="text-sm text-destructive">{errors.confirm_password}</p>
              )}
            </div>

            <Button
              type="submit"
              fullWidth
              loading={isSubmitting}
              disabled={isSubmitting}
              className="h-11 text-base mt-2"
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              to="/signin"
              className="text-primary font-medium hover:underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
