'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { THEME_STORAGE_KEY } from './theme-script';

/** §6 — three modes. `system` follows the OS and keeps following it. */
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** What the user picked (may be `system`). */
  mode: ThemeMode;
  /** What is actually painted. */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /**
   * Pushed in by whatever knows the signed-in user's profile. Highest priority
   * in the resolution order, but only applied while the user has not made an
   * explicit local choice in this browser.
   */
  applyProfilePreference: (mode: ThemeMode | undefined) => void;
  /** True once the client has taken over from the no-flash bootstrap script. */
  hydrated: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredMode(): ThemeMode | undefined {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

export function ThemeProvider({
  children,
  /** Optional server-known preference; also settable later via context. */
  profilePreference,
}: {
  children: ReactNode;
  profilePreference?: ThemeMode;
}) {
  /*
   * Resolution order (§6):
   *   1. user profile preference (server / API)
   *   2. localStorage (explicit choice in this browser)
   *   3. prefers-color-scheme
   *   4. light
   *
   * (1) beats (2) only until the user toggles locally — after that the local
   * choice wins, otherwise the toggle would appear to do nothing.
   */
  const [mode, setModeState] = useState<ThemeMode>(profilePreference ?? 'system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');
  const [hydrated, setHydrated] = useState(false);
  const explicitLocalChoice = useRef(false);

  // Take over from the bootstrap script.
  useEffect(() => {
    const stored = readStoredMode();
    if (stored) explicitLocalChoice.current = true;
    const initial = stored ?? profilePreference ?? 'system';
    setModeState(initial);
    setResolved(resolve(initial));
    setHydrated(true);

    /*
     * The soft 200ms cross-fade is enabled one frame *after* mount so the first
     * paint is not animated — that is what would read as a full-page flash.
     */
    const raf = window.requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-transition');
    });
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paint whatever is resolved.
  useEffect(() => {
    if (!hydrated) return;
    const el = document.documentElement;
    el.setAttribute('data-theme', resolved);
    el.style.colorScheme = resolved;
  }, [resolved, hydrated]);

  // Keep following the OS while in `system`.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    explicitLocalChoice.current = true;
    setModeState(next);
    setResolved(resolve(next));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode / storage blocked — theme simply will not persist. */
    }
  }, []);

  const applyProfilePreference = useCallback((next: ThemeMode | undefined) => {
    if (!next || explicitLocalChoice.current) return;
    setModeState(next);
    setResolved(resolve(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, applyProfilePreference, hydrated }),
    [mode, resolved, setMode, applyProfilePreference, hydrated],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
