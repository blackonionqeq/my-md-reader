import type { LastOpened, ReaderSettings, ThemeMode } from './types';

const SETTINGS_KEY = 'my-md-reader:settings';
const LAST_OPENED_KEY = 'my-md-reader:last-opened';

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
  updateThemeColor(theme);
}

function resolveEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const THEME_COLORS = { light: '#f8fafc', dark: '#0f172a' } as const;

let systemThemeCleanup: (() => void) | null = null;

function updateThemeColor(theme: ThemeMode): void {
  if (systemThemeCleanup) {
    systemThemeCleanup();
    systemThemeCleanup = null;
  }

  setMetaThemeColor(resolveEffectiveTheme(theme));

  if (theme === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setMetaThemeColor(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    systemThemeCleanup = () => mq.removeEventListener('change', handler);
  }
}

function setMetaThemeColor(effective: 'light' | 'dark'): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[effective]);
  }
}

// Stored in localStorage (not IndexedDB) so it's available synchronously at
// startup before Dexie is ready. The scroll position itself lives in the
// readingStates table — this only tracks which group+article to reopen.
export function loadLastOpened(): LastOpened | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(LAST_OPENED_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LastOpened>;
    if (typeof parsed.groupId !== 'string' || typeof parsed.articleId !== 'string') {
      return null;
    }

    return {
      groupId: parsed.groupId,
      articleId: parsed.articleId,
      directoryScrollTop: typeof parsed.directoryScrollTop === 'number' ? parsed.directoryScrollTop : undefined
    };
  } catch {
    return null;
  }
}

export function saveLastOpened(groupId: string, articleId: string): void {
  const existing = loadLastOpened();
  localStorage.setItem(LAST_OPENED_KEY, JSON.stringify({
    groupId,
    articleId,
    directoryScrollTop: existing?.groupId === groupId ? existing.directoryScrollTop : 0
  }));
}

export function saveDirectoryScroll(scrollTop: number): void {
  const existing = loadLastOpened();
  if (!existing) return;
  localStorage.setItem(LAST_OPENED_KEY, JSON.stringify({ ...existing, directoryScrollTop: scrollTop }));
}

export function clearLastOpened(): void {
  localStorage.removeItem(LAST_OPENED_KEY);
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
