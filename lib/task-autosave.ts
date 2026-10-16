export type SaveState = "saved" | "unsaved" | "saving" | "error";

/** Drain the latest draft serially, so a slower save cannot overwrite a newer edit. */
export function createTaskAutosave<Draft>({ read, save }: { read: () => Draft | null; save: (draft: Draft) => Promise<boolean> }) {
  let state: SaveState = "saved";
  let running: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  function publish(next: SaveState) {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getState: () => state,
    changed() { if (!running) publish(read() === null ? "saved" : "unsaved"); },
    flush(): Promise<boolean> {
      if (running) return running;
      running = Promise.resolve().then(async () => {
        for (;;) {
          const draft = read();
          if (draft === null) { publish("saved"); return true; }
          publish("saving");
          let saved = false;
          try { saved = await save(draft); } catch { /* The editor keeps the draft available for retry. */ }
          if (!saved) { publish("error"); return false; }
        }
      }).finally(() => { running = null; });
      return running;
    },
  };
}
