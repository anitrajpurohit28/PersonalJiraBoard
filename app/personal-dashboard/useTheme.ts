"use client";
import { useSyncExternalStore } from "react";
import { defaultTheme, themeStorageKey, type Theme } from "../../lib/theme";

import { syncThemeIcon } from "./native-theme";

const eventName = "personal-board-theme";
let fallback: Theme = defaultTheme;
const serverSnapshot = () => defaultTheme;
function snapshot(): Theme {
  try { const saved = window.localStorage.getItem(themeStorageKey); if (saved === "light" || saved === "dark") return saved; } catch {}
  return fallback;
}
function subscribe(callback: () => void) {
  const apply = () => { const theme = snapshot(); document.documentElement.dataset.theme = theme; syncThemeIcon(theme); };
  const update = () => { apply(); callback(); };
  apply();
  window.addEventListener("storage", update); window.addEventListener(eventName, update);
  return () => { window.removeEventListener("storage", update); window.removeEventListener(eventName, update); };
}
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  function toggle() {
    fallback = snapshot() === "dark" ? "light" : "dark";
    try { window.localStorage.setItem(themeStorageKey, fallback); } catch {}
    document.documentElement.dataset.theme = fallback;
    window.dispatchEvent(new Event(eventName));
  }
  return [theme, toggle] as const;
}
