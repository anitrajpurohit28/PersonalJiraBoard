"use client";
import { useEffect, useRef, useState } from "react";
import { completedSince, createTaskSoundPlayer } from "../../lib/task-sounds.mjs";
import type { Task } from "../../lib/task-types";
type NativeSounds = { webkit?: { messageHandlers?: { taskSounds?: { postMessage: (name: string) => void } } }; chrome?: { webview?: { postMessage: (message: unknown) => void } } };
export function useTaskSounds(tasks: Task[], loading: boolean) {
  const [player] = useState(() => createTaskSoundPlayer({ nativePlay: (name: string) => {
    const host = window as Window & NativeSounds;
    if (host.webkit?.messageHandlers?.taskSounds) { host.webkit.messageHandlers.taskSounds.postMessage(name); return true; }
    if (host.chrome?.webview) { host.chrome.webview.postMessage({ type: "task-sound", name }); return true; }
    return false;
  } }));
  const previous = useRef<Map<number, boolean> | null>(null);
  useEffect(() => {
    if (loading) return;
    if (completedSince(previous.current, tasks)) player.play("complete");
    previous.current = new Map(tasks.map(task => [task.id, task.archived]));
  }, [tasks, loading, player]);
  useEffect(() => {
    const unlock = () => player.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => { window.removeEventListener("pointerdown", unlock, true); window.removeEventListener("keydown", unlock, true); };
  }, [player]);
  return player;
}
