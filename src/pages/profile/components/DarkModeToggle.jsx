import React from 'react';
import Icon from '../../../components/AppIcon';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../utils/cn';
import './dark-mode-toggle.css';

const DarkModeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const isDarkMode = theme === 'dark';

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {isDarkMode ? <Icon name="Moon" size={22} aria-hidden="true" /> : <Icon name="Sun" size={22} aria-hidden="true" />}
        </div>
        <div>
          <h4 className="text-base font-semibold text-foreground">Dark mode</h4>
          <p className="text-sm text-muted-foreground">
            {isDarkMode ? 'Currently using dark theme' : 'Currently using light theme'}
          </p>
        </div>
      </div>

      <button
        onClick={toggleTheme}
        className={cn(
          'relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isDarkMode ? 'bg-primary' : 'bg-muted',
        )}
        role="switch"
        aria-checked={isDarkMode}
        aria-label="Toggle dark mode"
        type="button"
      >
        <span
          className={cn(
            'inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform duration-200',
            isDarkMode ? 'translate-x-7' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
};

export default DarkModeToggle;
