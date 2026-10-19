"use client";
import { useSyncExternalStore } from "react";
import { storageNamespace } from "../../config/settings.mjs";
type BoardSort = "priority" | "oldest" | "manual";
const key = `${storageNamespace}-board-sort`, eventName = "personal-board-sort";
let fallback: BoardSort = "priority";
function snapshot(): BoardSort {
  try { const value = window.localStorage.getItem(key); if (value === "priority" || value === "oldest" || value === "manual") return value; } catch {}
  return fallback;
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); };
}
export function useBoardSort() {
  const sort = useSyncExternalStore(subscribe, snapshot, () => "priority" as BoardSort);
  function setSort(value: string) {
    if (value !== "priority" && value !== "oldest" && value !== "manual") return;
    fallback = value;
    try { window.localStorage.setItem(key, value); } catch {}
    window.dispatchEvent(new Event(eventName));
  }
  return [sort, setSort] as const;
}
