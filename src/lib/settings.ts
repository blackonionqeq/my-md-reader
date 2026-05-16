import type { ReaderSettings, ThemeMode } from './types';

const SETTINGS_KEY = 'my-md-reader:settings';

export const defaultSettings: ReaderSettings = {
  theme: 'system',
  fontSize: 18
};

export function loadSettings(): ReaderSettings {
  if (typeof localStorage === 'undefined') {
    return defaultSettings;
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultSettings;
    }

    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      theme: normalizeTheme(parsed.theme),
      fontSize: normalizeFontSize(parsed.fontSize)
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: ReaderSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
}

export function normalizeFontSize(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return defaultSettings.fontSize;
  }

  return Math.max(14, Math.min(24, Math.round(value)));
}

function normalizeTheme(value: unknown): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return defaultSettings.theme;
}
