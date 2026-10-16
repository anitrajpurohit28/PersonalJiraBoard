"use client";

import { useEffect, useState } from "react";
import type { SyncQueue } from "../../lib/task-types";
import { TaskModal } from "./TaskModal";
import { requestJson } from "./api";

export function SyncQueuePanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [queue, setQueue] = useState<SyncQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = () => { void requestJson("/api/jira/queue").then((next) => { if (!cancelled) setQueue(next); }).catch((error) => { if (!cancelled) setError(error.message); }); };
    load(); const timer = window.setInterval(load, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  async function action(id: string, type: "retry" | "discard", uncertain: boolean) {
    const message = type === "discard" ? "Discard this local change? For a new unsynced task, its local subtasks, comments and attachments will also be discarded." : uncertain ? "Check Jira first: it may already have saved this change. Retry only after confirming it is missing, to avoid duplicates. Retry now?" : "Keep your saved change and retry it against Jira's current version?";
    if (!window.confirm(message)) return;
    setBusy(true); setError("");
    try { setQueue(await requestJson("/api/jira/queue", { method: "POST", body: JSON.stringify({ action: type, id, confirm: true }) })); await onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to update the pending change."); }
    finally { setBusy(false); }
  }
  return <TaskModal title="Pending changes" busy={busy} onClose={onClose}>
    <p className="muted">Changes are saved on this device before syncing. Jira conflicts and permissions are checked before they are applied.</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {!queue ? <p>Loading…</p> : !queue.pending ? <p>All changes have synced.</p> : queue.entries.map((entry) => <article className={`sync-entry ${["conflict", "failed", "uncertain"].includes(entry.status) ? "needs-attention" : ""}`} key={entry.id}>
      <strong>{entry.label} · {entry.title}</strong><small>{entry.status === "sending" ? "Syncing…" : entry.status === "pending" ? "Saved on this device" : "Needs attention"}</small>
      {entry.error ? <p>{entry.error}</p> : null}
      {entry.conflicts.map((conflict) => <div className="conflict-comparison" key={conflict.field}><strong>{conflict.field}</strong><p>Jira: {conflict.remote || "(empty)"}</p><p>Your change: {conflict.local || "(empty)"}</p></div>)}
      {entry.status !== "sending" ? <div className="item-actions">{entry.status !== "pending" ? <button disabled={busy} onClick={() => void action(entry.id, "retry", entry.status === "uncertain")}>{entry.status === "conflict" ? "Keep my changes" : "Retry"}</button> : null}<button className="danger" disabled={busy || entry.status === "uncertain"} onClick={() => void action(entry.id, "discard", false)}>Discard local change</button></div> : null}
    </article>)}
  </TaskModal>;
}
