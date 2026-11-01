"use client";
import { useEffect, useRef } from "react";
import { tagForShortcut, type TaskTag } from "../../lib/task-tags";

type TagBridge = {
  webkit?: { messageHandlers?: { taskTagShortcuts?: { postMessage: (keys: string[]) => void } } };
  chrome?: { webview?: { postMessage: (message: { type: string; keys: string[] }) => void } };
};
export function useTagShortcuts(tags: TaskTag[], enabled: boolean, onAdd: (id: string) => void) {
  const add = useRef(onAdd);
  useEffect(() => { add.current = onAdd; }, [onAdd]);
  useEffect(() => {
    const host = window as Window & TagBridge;
    const register = (keys: string[]) => {
      host.webkit?.messageHandlers?.taskTagShortcuts?.postMessage(keys);
      host.chrome?.webview?.postMessage({ type: "task-tag-shortcuts", keys });
    };
    register(enabled ? tags.flatMap((tag) => tag.shortcut ? [tag.shortcut] : []) : []);
    if (!enabled) return;
    function keydown(event: KeyboardEvent) {
      const tag = tagForShortcut(tags, event);
      if (!tag) return;
      event.preventDefault(); event.stopImmediatePropagation(); add.current(tag.id);
    }
    function nativeShortcut(event: Event) {
      const key = (event as CustomEvent<unknown>).detail;
      if (typeof key !== "string") return;
      const tag = tagForShortcut(tags, { key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false });
      if (tag) add.current(tag.id);
    }
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("task-board-tag-shortcut", nativeShortcut);
    return () => {
      register([]);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("task-board-tag-shortcut", nativeShortcut);
    };
  }, [tags, enabled]);
}
