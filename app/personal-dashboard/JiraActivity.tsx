"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { adfText } from "../../lib/jira-fields.mjs";
import type { Task } from "../../lib/task-types";
import { LinkedText, DraftLinks } from "./LinkedText";
import { requestJson } from "./api";
import { JiraTaskLink, WebJiraLink } from "./JiraTaskLink";

type Comment = { id: string; body: unknown; author?: { accountId?: string; displayName?: string }; created?: string; pending?: boolean };
type Link = { id: string; type?: { id: string; inward: string; outward: string }; inwardIssue?: { key: string; fields?: { summary?: string } }; outwardIssue?: { key: string; fields?: { summary?: string } }; pending?: boolean };
type Activity = { comments: Comment[]; links: Link[]; linkTypes: Array<{ id: string; inward: string; outward: string }>; accountId: string; offline?: boolean; cached?: boolean; attachmentSettings?: { enabled?: boolean } };

export function JiraActivity({ task, tasks, onChanged, onOpenTask, afterComments, footer }: { task: Task; tasks: Task[]; onChanged: () => Promise<void>; onOpenTask: (id: number) => void; afterComments: ReactNode; footer: ReactNode }) {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [relationship, setRelationship] = useState("");
  const [cachedTarget, setCachedTarget] = useState("");
  const operationId = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const commentHelpId = useId();
  const load = useCallback(async (refresh = false) => {
    const next = await requestJson(`/api/tasks/${task.id}/details${refresh ? "?refresh=1" : ""}`) as Activity;
    setData(next);
  }, [task.id]);
  useEffect(() => {
    let cancelled = false;
    void requestJson(`/api/tasks/${task.id}/details`).then((next) => { if (!cancelled) { setData(next); void load(true).catch(() => {}); } }).catch((error) => { if (!cancelled) setError(error.message); });
    const timer = window.setInterval(() => { void load(true).catch(() => {}); }, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [load, task.id]);

  async function mutate(action: string, payload: Record<string, unknown>) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true); setError("");
    try {
      await requestJson(`/api/tasks/${task.id}/activity`, { method: "POST", body: JSON.stringify({ action, ...payload }) });
      await load(); await onChanged(); return true;
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save this change."); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim() || saving.current) return;
    if (await mutate(editing ? "comment-edit" : "comment-add", { body: comment, commentId: editing, operationId: operationId.current })) {
      setComment(""); setEditing(null); operationId.current = crypto.randomUUID();
    }
  }
  if (!data) return <><section className="activity-section" aria-label="Comments"><h3>Comments</h3><p role={error ? "alert" : "status"}>{error || "Loading cached activity…"}</p></section>{afterComments}{footer}</>;
  return <><section className="activity-section" aria-label="Comments">
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {data.offline ? <p className="offline-note">Offline. Changes are saved on this device until Jira is available.</p> : null}
    <h3>Comments</h3>
    {!data.cached ? <p className="muted">Existing Jira comments have not been cached yet.</p> : null}
    {data.comments.map((entry) => <article className="comment-entry" key={entry.id}>
      <small>{entry.author?.displayName || "You"}{entry.created ? ` · ${new Date(entry.created).toLocaleString()}` : ""}{entry.pending ? " · Pending sync" : ""}</small>
      <p><LinkedText text={adfText(entry.body).trimEnd()} /></p>
      {entry.author?.accountId === data.accountId ? <div className="item-actions"><button type="button" disabled={busy} onClick={() => { setEditing(entry.id); setComment(adfText(entry.body).trimEnd()); }}>Edit comment</button><button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm("Delete this Jira comment? If offline, it will be deleted when syncing resumes.")) void mutate("comment-delete", { commentId: entry.id, confirmDelete: true }); }}>Delete comment</button></div> : null}
    </article>)}
    {!data.comments.length && data.cached ? <p className="muted">No comments.</p> : null}
    <form onSubmit={(event) => void submitComment(event)}><label>{editing ? "Edit Jira comment" : "Add Jira comment"}<textarea rows={3} maxLength={32000} value={comment} disabled={busy} aria-describedby={commentHelpId} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      if (comment.trim() && !saving.current) event.currentTarget.form?.requestSubmit();
    }} /></label><DraftLinks text={comment} /><small id={commentHelpId}>Enter to save · Shift+Enter for a new line</small><div className="item-actions">{editing ? <button type="button" disabled={busy} onClick={() => { setEditing(null); setComment(""); }}>Cancel edit</button> : null}<button disabled={busy || !comment.trim()}>{editing ? "Save comment" : "Add comment"}</button></div></form>
  </section>
  {afterComments}
  <section className="activity-section" aria-label="Linked tasks">
    <h3>Linked tasks</h3>
    {data.links.map((link) => {
      const other = link.outwardIssue || link.inwardIssue;
      const cached = tasks.find((row) => row.jiraKey === other?.key);
      const jiraUrl = cached?.jiraUrl || (task.jiraUrl && other && /^[A-Z][A-Z0-9_]*-\d+$/.test(other.key) ? new URL(`/browse/${other.key}`, task.jiraUrl).href : "");
      return <div className="attachment-entry" key={link.id}><div><span className="issue-links"><span>{link.outwardIssue ? link.type?.outward : link.type?.inward} ·</span>{other ? <JiraTaskLink jiraKey={other.key} onOpen={cached ? () => onOpenTask(cached.id) : undefined} disabled={busy} /> : null}{other ? <WebJiraLink jiraKey={other.key} href={jiraUrl} /> : null}</span><small>{other?.fields?.summary}{link.pending ? " · Pending sync" : ""}</small></div><button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm("Remove this issue link? The tasks themselves will be kept.")) void mutate("link-delete", { linkId: String(link.id), confirmDelete: true }); }}>Remove link</button></div>;
    })}
    {data.linkTypes.length ? <form onSubmit={(event) => { event.preventDefault(); const [typeId, direction] = relationship.split(":"); void mutate("link-add", { targetKey: cachedTarget || target.trim().toUpperCase(), typeId, direction }).then((saved) => { if (saved) { setTarget(""); setCachedTarget(""); } }); }}><div className="form-grid"><label>Relationship<select value={relationship} required disabled={busy} onChange={(event) => setRelationship(event.target.value)}><option value="">Choose…</option>{data.linkTypes.flatMap((type) => [<option key={`${type.id}:outward`} value={`${type.id}:outward`}>{type.outward}</option>, <option key={`${type.id}:inward`} value={`${type.id}:inward`}>{type.inward}</option>])}</select></label><label>Task to link<select value={cachedTarget} disabled={busy} onChange={(event) => setCachedTarget(event.target.value)}><option value="">Enter a Jira key…</option>{tasks.filter((row) => row.id !== task.id).map((row) => <option key={row.id} value={row.jiraKey}>{row.title}{row.jiraUrl ? ` (${row.jiraKey})` : " (pending sync)"}</option>)}</select></label></div>{!cachedTarget ? <label>Jira task key<input value={target} required disabled={busy} placeholder="e.g. KAN-2" onChange={(event) => setTarget(event.target.value)} /></label> : null}<button disabled={busy || (!cachedTarget && !target.trim()) || !relationship}>Link task</button></form> : <p className="muted">Link types have not been cached, or issue linking is unavailable in Jira.</p>}
  </section>
  {footer}
  </>;
}
