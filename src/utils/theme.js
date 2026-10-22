/**
 * Theme helpers.
 *
 * The persisted preference lives under the `darkMode` key in localStorage
 * (`'true'` / `'false'`). That key is part of the app's public contract and is
 * respected exactly as before — it is only extended with a system-preference
 * fallback for first-time visitors who have never chosen a theme.
 */
export const THEME_STORAGE_KEY = 'darkMode';

export const readStoredTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // localStorage can be unavailable (private mode / disabled storage).
  }
  return null;
};

export const prefersDarkTheme = () => {
  try {
    return !!window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  } catch {
    return false;
  }
};

/** Resolve the theme to use on boot: stored preference first, system second. */
export const resolveInitialTheme = () => {
  const stored = readStoredTheme();
  return stored === null ? prefersDarkTheme() : stored;
};

/** Apply a theme to the document root and persist it. */
export const applyTheme = (isDark) => {
  try {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    localStorage.setItem(THEME_STORAGE_KEY, String(isDark));
  } catch {
    // Ignore storage failures — the class toggle above already applied.
  }
};
