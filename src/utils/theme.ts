import type { ThemeMode } from "../models";

// IndexedDB is authoritative. This non-sensitive cache applies the saved mode
// before React and IndexedDB finish loading, including in the extension popup.
const THEME_CACHE_KEY = "planai_theme_mode_v1";
export const THEME_CHANGE_EVENT = "planai:theme-change";
let currentMode: ThemeMode = "system";
let systemPreference: MediaQueryList | undefined;
let initialized = false;

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

export function applyThemeMode(value: unknown, cache = true): void {
  currentMode = normalizeThemeMode(value);
  if (typeof document === "undefined") return;
  const theme = currentMode === "system" ? (systemPreference?.matches ? "dark" : "light") : currentMode;
  const root = document.documentElement;
  const changed = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  root.dataset.themeMode = currentMode;
  root.style.colorScheme = theme;
  if (cache) {
    try { localStorage.setItem(THEME_CACHE_KEY, currentMode); } catch { /* DB persistence still works without this cache. */ }
  }
  if (changed) window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function initializeTheme(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
  try { currentMode = normalizeThemeMode(localStorage.getItem(THEME_CACHE_KEY)); } catch { /* Follow the system until IndexedDB is ready. */ }
  systemPreference.addEventListener("change", () => applyThemeMode(currentMode, false));
  applyThemeMode(currentMode, false);
}

export function getResolvedTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function subscribeThemeChange(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}
