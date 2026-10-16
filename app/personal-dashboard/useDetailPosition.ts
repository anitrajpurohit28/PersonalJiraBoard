"use client";
import { useSyncExternalStore } from "react";
import { storageNamespace } from "../../config/settings.mjs";
import { uiSettings } from "../../config/ui-settings.mjs";
export type DetailPosition = "center" | "right";
const key = `${storageNamespace}-detail-position`, eventName = "personal-board-detail-position";
let fallback = uiSettings.taskDetailsPosition as DetailPosition;
const serverSnapshot = () => uiSettings.taskDetailsPosition as DetailPosition;
function snapshot(): DetailPosition {
  try { const value = window.localStorage.getItem(key); if (value === "center" || value === "right") return value; } catch {}
  return fallback;
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); };
}
export function useDetailPosition() {
  const position = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  function toggle() {
    fallback = position === "right" ? "center" : "right";
    try { window.localStorage.setItem(key, fallback); } catch {}
    window.dispatchEvent(new Event(eventName));
  }
  return [position, toggle] as const;
}
