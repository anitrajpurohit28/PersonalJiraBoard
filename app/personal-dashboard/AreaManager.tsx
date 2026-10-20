"use client";
import { useState, type FormEvent } from "react";
import type { TaskArea } from "../../lib/task-areas";
import { TaskModal } from "./TaskModal";
import { requestJson } from "./api";

export function AreaManager({ areas, onChanged, onClose }: { areas: TaskArea[]; onChanged: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true); setError("");
    try { await work(); await onChanged(); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to save area."); return false; }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await run(() => requestJson("/api/areas", { method: "POST", body: JSON.stringify({ name }) }))) setName("");
  }
  return <TaskModal title="Areas" busy={busy} onClose={onClose}>
    <p className="muted">Separate your tasks into areas such as Work, Personal or Learn. Each task belongs to one area; its subtasks follow it.</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <div className="area-manager-list" aria-label="Saved areas">{areas.map((area) => <AreaRow key={area.id} area={area} disabled={busy} onSave={(name) => run(() => requestJson(`/api/areas/${area.id}`, { method: "PATCH", body: JSON.stringify({ name }) }))} onDelete={() => {
      if (window.confirm(`Remove the “${area.name}” area? Its tasks and subtasks will move to Unassigned. No tasks will be deleted.`)) void run(() => requestJson(`/api/areas/${area.id}`, { method: "DELETE" }));
    }} />)}{!areas.length ? <p className="muted">No areas yet. Your existing tasks are in Unassigned.</p> : null}</div>
    <form className="new-area-form" onSubmit={(event) => void create(event)}><h3>New area</h3><div className="area-editor-row"><label>Name<input autoFocus required maxLength={60} placeholder="e.g. Work" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label><button className="primary" disabled={busy || !name.trim()}>Add area</button></div></form>
    <div className="form-actions"><span className="muted">Areas are private and work offline. Unassigned is always available.</span><button type="button" onClick={onClose} disabled={busy}>Done</button></div>
  </TaskModal>;
}
function AreaRow({ area, disabled, onSave, onDelete }: { area: TaskArea; disabled: boolean; onSave: (name: string) => Promise<boolean>; onDelete: () => void }) {
  const [name, setName] = useState(area.name);
  return <form className="area-editor-row saved-area-row" onSubmit={(event) => { event.preventDefault(); void onSave(name); }}>
    <label><span className="sr-only">Area name ({area.name})</span><input aria-label={`Area name (${area.name})`} required maxLength={60} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
    <button disabled={disabled || name === area.name}>Save</button><button type="button" className="danger" disabled={disabled} aria-label={`Remove area ${area.name}`} onClick={onDelete}>Remove</button>
  </form>;
}
