/**
 * ThemeContext — single source of truth for the light/dark preference.
 *
 * The preference is persisted under the `darkMode` localStorage key, which is
 * applied to the document root before the first paint by `src/index.jsx`.
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { applyTheme, resolveInitialTheme } from '../utils/theme';

const ThemeContext = createContext(null);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
};

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() => resolveInitialTheme());

  useEffect(() => {
    applyTheme(isDark);
  }, [isDark]);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  const setTheme = useCallback((next) => {
    setIsDark(!!next);
  }, []);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeProvider;
