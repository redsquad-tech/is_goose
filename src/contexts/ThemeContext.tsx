import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { applyThemeTokens } from '../theme/theme-tokens';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  userThemePreference: ThemePreference;
  setUserThemePreference: (pref: ThemePreference) => void;
  resolvedTheme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return getSystemTheme();
  }
  return preference;
}

function applyThemeToDocument(theme: ResolvedTheme): void {
  const toRemove = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.add(theme);
  document.documentElement.classList.remove(toRemove);
  document.documentElement.style.colorScheme = theme;
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Start with light theme to avoid flash, will update once settings load
  const [userThemePreference, setUserThemePreferenceState] = useState<ThemePreference>('light');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    async function loadThemeFromSettings() {
      try {
        const [useSystemTheme, savedTheme] = await Promise.all([
          window.electron.getSetting('useSystemTheme'),
          window.electron.getSetting('theme'),
        ]);

        let preference: ThemePreference;
        if (useSystemTheme) {
          preference = 'system';
        } else {
          preference = savedTheme;
        }

        setUserThemePreferenceState(preference);
        setResolvedTheme(resolveTheme(preference));
      } catch (error) {
        console.warn('[ThemeContext] Failed to load theme settings:', error);
      }
    }

    loadThemeFromSettings();
  }, []);

  const setUserThemePreference = useCallback(async (preference: ThemePreference) => {
    setUserThemePreferenceState(preference);

    const resolved = resolveTheme(preference);
    setResolvedTheme(resolved);

    // Save to settings
    try {
      if (preference === 'system') {
        await window.electron.setSetting('useSystemTheme', true);
      } else {
        await window.electron.setSetting('useSystemTheme', false);
        await window.electron.setSetting('theme', preference);
      }
    } catch (error) {
      console.warn('[ThemeContext] Failed to save theme settings:', error);
    }

  }, []);

  // Listen for system theme changes when preference is 'system'
  useEffect(() => {
    if (userThemePreference !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      setResolvedTheme(getSystemTheme());
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [userThemePreference]);

  // Apply theme class and CSS tokens whenever resolvedTheme changes
  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
    applyThemeTokens(resolvedTheme);
  }, [resolvedTheme]);

  const value: ThemeContextValue = {
    userThemePreference,
    setUserThemePreference,
    resolvedTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
