"use client";
import { useSyncExternalStore } from "react";
import { storageNamespace } from "../../config/settings.mjs";
const key = `${storageNamespace}-collapsed-subtasks`, eventName = "personal-board-subtasks";
let fallback = "[]";
function snapshot() {
  try { return window.localStorage.getItem(key) ?? "[]"; } catch { return fallback; }
}
function parse(value: string): Set<string> {
  try { const keys: unknown = JSON.parse(value); if (Array.isArray(keys)) return new Set(keys.filter((key): key is string => typeof key === "string")); } catch {}
  return new Set();
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); };
}
export function useCollapsedSubtasks() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "[]");
  function setCollapsed(keys: string[], collapse: boolean) {
    const next = parse(snapshot());
    for (const key of keys) { if (collapse) next.add(key); else next.delete(key); }
    fallback = JSON.stringify([...next]);
    try { window.localStorage.setItem(key, fallback); } catch {}
    window.dispatchEvent(new Event(eventName));
  }
  return [parse(value), setCollapsed] as const;
}
