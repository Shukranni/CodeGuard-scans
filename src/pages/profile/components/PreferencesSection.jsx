/**
 * PreferencesSection — application preferences.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../utils/cn';

// ── Toggle switch ─────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, id, label }) => (
  <button
    id={id}
    role="switch"
    type="button"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      checked ? 'bg-primary' : 'bg-muted',
    )}
  >
    <span
      className={cn(
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200',
        checked ? 'translate-x-[22px]' : 'translate-x-0.5',
      )}
    />
  </button>
);

// ── Preference row ────────────────────────────────────────────────────────────
const PrefRow = ({ icon, title, description, checked, onChange, id }) => (
  <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon name={icon} size={16} aria-hidden="true" />
      </div>
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          {title}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
    <Toggle id={id} checked={checked} onChange={onChange} label={title} />
  </div>
);

// ── Main section ──────────────────────────────────────────────────────────────
const PreferencesSection = () => {
  const { theme, setTheme } = useTheme();
  const isDarkMode = theme === 'dark';
  const [saved, setSaved] = useState(false);

  const handleDarkMode = (newVal) => {
    setTheme(newVal ? 'dark' : 'light');
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section aria-labelledby="preferences-heading">
      <h2 id="preferences-heading" className="mb-1 text-lg font-semibold text-foreground">
        Preferences
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Customize how CodeGuard looks and behaves for you.
      </p>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Appearance
        </h3>
        <div className="divide-y divide-border">
          <PrefRow
            id="pref-dark-mode"
            icon={isDarkMode ? 'Moon' : 'Sun'}
            title="Dark mode"
            description={
              isDarkMode
                ? 'Using the dark theme — easier on your eyes in low-light environments.'
                : 'Using the light theme — switch to dark for low-light conditions.'
            }
            checked={isDarkMode}
            onChange={handleDarkMode}
          />
        </div>

        {saved ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 flex items-center gap-1.5 text-xs text-low"
          >
            <Icon name="Check" size={13} aria-hidden="true" />
            Preference saved
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default PreferencesSection;
