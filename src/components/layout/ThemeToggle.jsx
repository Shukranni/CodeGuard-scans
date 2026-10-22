/**
 * ThemeToggle — switches between the light and dark palettes.
 *
 * The control is a single button whose accessible name states the action it
 * performs ("Switch to dark theme"), so it is unambiguous without seeing the
 * icon.
 */
import React from 'react';
import Icon from '../AppIcon';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../utils/cn';

const ThemeToggle = ({ className, showLabel = false, variant = 'ghost' }) => {
  const { isDark, toggleTheme } = useTheme();

  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center rounded-lg font-medium transition-colors',
        showLabel ? 'gap-2 px-3 py-2 text-sm' : 'h-9 w-9 justify-center',
        variant === 'ghost'
          ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
          : 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted',
        className,
      )}
    >
      <Icon name={isDark ? 'Sun' : 'Moon'} size={17} aria-hidden="true" />
      {showLabel ? <span>{isDark ? 'Light theme' : 'Dark theme'}</span> : null}
    </button>
  );
};

export default ThemeToggle;
