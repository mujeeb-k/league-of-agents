import { useSyncExternalStore } from 'react';

// Light, dark, or follow the system. The resolved theme is always on <html data-theme>;
// index.html sets it before first paint, so there is no flash of the wrong theme.
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'loa.theme';
const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function themeChoice(): ThemeChoice {
  let v: string | null = null;
  try {
    v = localStorage.getItem(KEY);
  } catch {
    /* storage blocked: follow the system */
  }
  return v === 'light' || v === 'dark' ? v : 'system';
}

export const resolvedTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export function applyTheme() {
  const c = themeChoice();
  document.documentElement.dataset.theme = c === 'dark' || (c === 'system' && systemDark()) ? 'dark' : 'light';
}

export function setTheme(c: ThemeChoice) {
  try {
    if (c === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  applyTheme();
}

/** Switches to the other theme and remembers it. */
export const toggleTheme = () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');

/** Follows the system while no explicit choice is made; calls onChange after every switch. */
export function watchSystemTheme(onChange: () => void) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeChoice() === 'system') applyTheme();
    onChange();
  });
}

/** The resolved theme for React components, following changes to <html data-theme>. */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(cb => {
    const mo = new MutationObserver(cb);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, resolvedTheme);
}
