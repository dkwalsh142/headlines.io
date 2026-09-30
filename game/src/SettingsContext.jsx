import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Player preferences, persisted to localStorage so they survive reloads.
// Add new options (sound, etc.) to DEFAULT_SETTINGS and the Settings page;
// anything missing from a stored blob falls back to its default, so adding
// keys never needs a migration.

const STORAGE_KEY = 'headlines.settings';

export const DEFAULT_SETTINGS = {
  stampText: true, // letter-by-letter "stamp" animation on headlines/results
  pageRock: true, // newspaper pages gently rock back and forth
};

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, blocked site data): the setting
    // still applies for this session, it just won't be remembered.
  }
}

const SettingsContext = createContext({ settings: DEFAULT_SETTINGS, setSetting: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);

  const setSetting = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }, []);

  // Page rocking is pure CSS (Newspaper.css), so it's switched with a flag
  // on <html> rather than by threading the setting through every paper.
  useEffect(() => {
    document.documentElement.dataset.pageRock = settings.pageRock ? 'on' : 'off';
  }, [settings.pageRock]);

  const value = useMemo(() => ({ settings, setSetting }), [settings, setSetting]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
