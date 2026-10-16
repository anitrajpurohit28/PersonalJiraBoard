"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createTaskAutosave } from "../../lib/task-autosave";

export function useTaskAutosave<Draft>(changeKey: string, enabled: boolean, read: () => Draft | null, save: (draft: Draft) => Promise<boolean>) {
  const [bridge] = useState(() => {
    let latest = { read, save };
    return { controller: createTaskAutosave<Draft>({ read: () => latest.read(), save: (draft) => latest.save(draft) }), update(next: typeof latest) { latest = next; } };
  });
  useEffect(() => { bridge.update({ read, save }); });
  const controller = bridge.controller;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => {
    if (!enabled) return;
    controller.changed();
    const timer = window.setTimeout(() => { void controller.flush(); }, 650);
    return () => window.clearTimeout(timer);
  }, [changeKey, enabled, controller]);
  useEffect(() => {
    if (!enabled) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (controller.getState() !== "saved") event.preventDefault(); };
    const hide = () => { if (document.visibilityState === "hidden") void controller.flush(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("visibilitychange", hide); };
  }, [enabled, controller]);
  return { state, flush: controller.flush };
}
