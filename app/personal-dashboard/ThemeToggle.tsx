"use client";
import { useTheme } from "./useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const dark = theme === "dark", label = `Switch to ${dark ? "light" : "dark"} theme`;
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} aria-pressed={dark} title={label}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5a8.5 8.5 0 1 0 10.6 10.6Z" />}</svg>
    <span>{dark ? "Light" : "Dark"}</span>
  </button>;
}
