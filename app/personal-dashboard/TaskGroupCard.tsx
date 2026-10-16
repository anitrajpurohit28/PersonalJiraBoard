"use client";
import type { TaskGroup } from "../../lib/board-tasks";
import { PRIORITIES, type Task } from "../../lib/task-types";
import { hasFiredReminder } from "../../lib/task-reminders";
import { JiraTaskLink, WebJiraLink } from "./JiraTaskLink";
const formatDate = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export function TaskGroupCard({ group, checked, selectedId, disabled, onToggle, onOpen, onMove, onDragStart, onDragEnd, onDrop }: {
  group: TaskGroup; checked: Set<number>; disabled: boolean; onToggle: (id: number) => void; onOpen: (id: number) => void; onMove: (task: Task) => void;
  selectedId: number | null;
  onDragStart?: () => void; onDragEnd?: () => void; onDrop?: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const task = group.parent, tint = task || group.matches[0] || group.children[0];
  const selectable = new Set(group.matches.map((task) => task.id));
  const comments = task?.comments?.slice(0, 2) || [];
  const open = () => { if (task) onOpen(task.id); };
  const isOpen = task?.id === selectedId || group.children.some((child) => child.id === selectedId);
  const reminderFired = Boolean(task && hasFiredReminder(task)) || group.children.some(hasFiredReminder);
  return <article className={`task-card priority-surface-${tint.priority} ${task && checked.has(task.id) ? "checked" : ""} ${isOpen ? "task-open" : ""} ${reminderFired ? "reminder-due" : ""}`} data-task-key={task?.jiraKey || group.key} draggable={Boolean(task && !disabled && !task.archived)} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,select,textarea,label,summary") && !window.getSelection()?.toString()) open(); }}>
    {task ? <>
      <div className="card-top"><input type="checkbox" aria-label={`Select ${task.title}`} checked={checked.has(task.id)} disabled={disabled || !selectable.has(task.id)} onChange={() => onToggle(task.id)} /><span className={`priority priority-${task.priority}`}>{PRIORITIES[task.priority]}</span><span className="source-label issue-links">{task.source === "jira" ? <><JiraTaskLink jiraKey={task.jiraKey} onOpen={open} disabled={disabled} /><WebJiraLink jiraKey={task.jiraKey} href={task.jiraUrl} /></> : "Local"}</span></div>
      <button type="button" className="task-title" aria-current={task.id === selectedId ? "true" : undefined} onClick={open}>{task.title}</button>
      {isOpen ? <span className="open-indicator">{task.id === selectedId ? "Open task" : "Open subtask"}</span> : null}
      {reminderFired ? <span className="reminder-indicator">{hasFiredReminder(task) ? "Reminder fired" : "Subtask reminder fired"}</span> : null}
      {!selectable.has(task.id) ? <small className="context-parent">Parent shown for context · {task.state || (task.archived ? "Done" : "Active")}</small> : null}
      {task.syncStatus !== "synced" && task.source === "jira" ? <p className={`sync-badge ${task.syncStatus === "attention" ? "needs-attention" : ""}`} title={task.syncError}>{task.syncStatus === "attention" ? "Sync needs attention" : "Saved locally · Pending sync"}</p> : null}
      {task.notes ? <p className="notes-preview">{task.notes}</p> : null}
      {comments.length ? <section className="card-comments" aria-label={`Recent comments on ${task.title}`}><h3>Recent comments</h3>{comments.map((comment) => <div className="card-comment" key={comment.id}><small>{comment.author}{comment.updatedAt ? ` · ${formatDate(comment.updatedAt)}` : ""}{comment.pending ? " · Pending sync" : ""}</small><p>{comment.body}</p></div>)}</section> : null}
    </> : <h3 className="orphan-heading">Subtasks · {group.key === "parent:unavailable" ? "Parent not cached" : group.key.replace(/^parent:/, "")}</h3>}
    {group.children.length ? <section className="card-subtasks" aria-label={`Subtasks of ${task?.title || "uncached parent"}`}><h3>Subtasks <span>{group.children.filter((child) => child.archived).length}/{group.children.length} done</span></h3>{group.children.map((child) => <div className={`card-subtask priority-surface-${child.priority} ${child.archived ? "subtask-done" : ""} ${child.id === selectedId ? "subtask-open" : ""}`} data-task-key={child.jiraKey} key={child.id}>
      <div className="subtask-line"><input type="checkbox" aria-label={`Select ${child.title}`} checked={checked.has(child.id)} disabled={disabled || !selectable.has(child.id)} onChange={() => onToggle(child.id)} /><JiraTaskLink jiraKey={child.jiraKey} onOpen={() => onOpen(child.id)} disabled={disabled} /><span className="subtask-separator" aria-hidden="true">|</span><button type="button" className="subtask-title" aria-current={child.id === selectedId ? "true" : undefined} onClick={() => onOpen(child.id)}>{child.title}</button></div>
      <div className="subtask-meta"><span className="subtask-state">{child.archived ? "✓ " : ""}{child.state || (child.archived ? "Done" : "Active")}</span><WebJiraLink jiraKey={child.jiraKey} href={child.jiraUrl} /></div>
      {child.notifyAt ? <small className="subtask-reminder">{hasFiredReminder(child) ? "Reminder fired" : "Reminder"} · {formatDate(child.notifyAt)}</small> : null}
      {child.syncStatus !== "synced" ? <small className="subtask-pending">{child.syncStatus === "attention" ? "Sync needs attention" : "Pending sync"}</small> : null}
      {child.comments?.[0] ? <p className="subtask-comment"><strong>{child.comments[0].author}:</strong> {child.comments[0].body}</p> : null}
    </div>)}</section> : null}
    {task ? <>
      {task.dueDate ? <p className="task-due">Due {task.dueDate}</p> : null}
      <div className="card-footer"><span>{task.notifyAt ? `${hasFiredReminder(task) ? "Reminder fired" : "Reminder"} · ${formatDate(task.notifyAt)}` : task.state ?? ""}</span><button type="button" onClick={() => onMove(task)} disabled={disabled} aria-label={`${task.archived ? "Restore" : "Mark done"}: ${task.title}`}>{task.archived ? "Restore" : "Done"}</button></div>
    </> : <p className="muted">The parent is outside the cached board. Open a subtask to view its details.</p>}
  </article>;
}
