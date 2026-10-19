"use client";
import { useState, type FormEvent } from "react";
import type { TaskTag } from "../../lib/task-tags";
import { TaskModal } from "./TaskModal";
import { requestJson } from "./api";

export function TagManager({ tags, onChanged, onClose }: { tags: TaskTag[]; onChanged: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true); setError("");
    try { await work(); await onChanged(); return true; }
    catch (error) {
      if ((error as { status?: number }).status === 409) await onChanged().catch(() => {});
      setError(error instanceof Error ? error.message : "Unable to save tag."); return false;
    }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await run(() => requestJson("/api/tags", { method: "POST", body: JSON.stringify({ name, shortcut }) }))) { setName(""); setShortcut(""); }
  }
  function reorder(next: TaskTag[]) {
    return run(() => requestJson("/api/tags/order", { method: "PUT", body: JSON.stringify({ ids: next.map((tag) => tag.id) }) }));
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...tags];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void reorder(next);
  }
  return <TaskModal title="Tags" busy={busy} onClose={onClose}>
    <p className="muted">Create your own tags. In an open task, press Cmd (Mac) or Ctrl (Windows) plus its shortcut to add it.</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <div className="section-heading tag-order-heading"><h3>Tag order</h3><button type="button" disabled={busy || tags.length < 2} onClick={() => void reorder([...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)))}>Sort A–Z</button></div>
    <p className="muted tag-order-help">Use ↑ and ↓ to choose the order shown in tasks. Order saves automatically.</p>
    <div className="tag-manager-list" aria-label="Saved tags">{tags.map((tag, index) => <TagRow key={tag.id} tag={tag} disabled={busy} first={index === 0} last={index === tags.length - 1} onMove={(direction) => move(index, direction)} onSave={(name, shortcut) => run(() => requestJson(`/api/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name, shortcut }) }))} onDelete={() => {
      if (window.confirm(`Delete the “${tag.name}” tag and remove it from all tasks? The tasks will be kept.`)) void run(() => requestJson(`/api/tags/${tag.id}`, { method: "DELETE" }));
    }} />)}{!tags.length ? <p className="muted">No tags yet.</p> : null}</div>
    <form className="new-tag-form" onSubmit={(event) => void create(event)}><h3>New tag</h3><div className="tag-editor-row"><label>Name<input autoFocus required maxLength={60} placeholder="e.g. Work" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label><label>Shortcut<span className="tag-shortcut-input"><span>Cmd / Ctrl +</span><input aria-label="New tag shortcut" maxLength={1} placeholder="—" value={shortcut} disabled={busy} onChange={(event) => setShortcut(event.target.value.toLowerCase())} /></span></label><button className="primary" disabled={busy || !name.trim()}>Add tag</button></div><p className="muted">Shortcut is optional: one letter, number, - or =. Standard edit and quit shortcuts stay available.</p></form>
    <div className="form-actions"><span className="muted">Tags are private and saved on this device.</span><button type="button" onClick={onClose} disabled={busy}>Done</button></div>
  </TaskModal>;
}
function TagRow({ tag, disabled, first, last, onMove, onSave, onDelete }: { tag: TaskTag; disabled: boolean; first: boolean; last: boolean; onMove: (direction: -1 | 1) => void; onSave: (name: string, shortcut: string) => Promise<boolean>; onDelete: () => void }) {
  const [name, setName] = useState(tag.name);
  const [shortcut, setShortcut] = useState(tag.shortcut || "");
  const changed = name !== tag.name || shortcut !== (tag.shortcut || "");
  return <form className="tag-editor-row saved-tag-row" onSubmit={(event) => { event.preventDefault(); void onSave(name, shortcut); }}>
    <label><span className="sr-only">Tag name ({tag.name})</span><input aria-label={`Tag name (${tag.name})`} required maxLength={60} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
    <label><span className="sr-only">Shortcut for {tag.name}</span><span className="tag-shortcut-input"><span>Cmd / Ctrl +</span><input aria-label={`Shortcut for ${tag.name}`} maxLength={1} placeholder="—" value={shortcut} disabled={disabled} onChange={(event) => setShortcut(event.target.value.toLowerCase())} /></span></label>
    <div className="tag-row-actions"><button type="button" className="tag-move-button" disabled={disabled || first} aria-label={`Move ${tag.name} up`} title="Move up" onClick={() => onMove(-1)}>↑</button><button type="button" className="tag-move-button" disabled={disabled || last} aria-label={`Move ${tag.name} down`} title="Move down" onClick={() => onMove(1)}>↓</button><button type="submit" disabled={disabled || !changed}>Save</button><button type="button" className="danger" disabled={disabled} aria-label={`Delete tag ${tag.name}`} onClick={onDelete}>Delete</button></div>
  </form>;
}
