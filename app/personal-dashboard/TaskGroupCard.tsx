"use client";

import { LinkedText } from "./LinkedText";
import { useId } from "react";
import { taskAgeInDays, taskCreationTime, type TaskGroup } from "../../lib/board-tasks";
import { PRIORITIES, type Task } from "../../lib/task-types";
import { hasFiredReminder } from "../../lib/task-reminders";
import { JiraTaskLink, WebJiraLink } from "./JiraTaskLink";
const formatDate = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function TaskAgeBadge({ task, compact = false }: { task: Task; compact?: boolean }) {
  const days = taskAgeInDays(task);
  if (days === null) return null;
  const since = task.source === "jira" && !task.jiraCreatedAt ? "first tracked (Jira creation date unavailable)" : "created";
  const label = `${days} ${days === 1 ? "day" : "days"} since ${since}`;
  const band = days < 7 ? "fresh" : days <= 20 ? "aging" : "old";
  return <span className={`task-age task-age-${band}${compact ? " task-age-compact" : ""}`} title={`${label} · ${new Date(taskCreationTime(task)!).toLocaleString()}`} aria-label={label}>{days}</span>;
}

export function TaskGroupCard({ group, filterSubtasks = false, checked, selectedId, disabled, onToggle, onOpen, onMove, onDragStart, onDragEnd, onDrop, onSubtaskDrop, subtasksCollapsed, onToggleSubtasks, onTagFilter }: {
  onTagFilter: (id: string) => void;
  group: TaskGroup; filterSubtasks?: boolean; checked: Set<number>; disabled: boolean; onToggle: (id: number) => void; onOpen: (id: number) => void; onMove: (task: Task) => void;
  selectedId: number | null; subtasksCollapsed: boolean; onToggleSubtasks: () => void;
  onDragStart?: (id: number) => void; onDragEnd?: () => void; onDrop?: (event: React.DragEvent<HTMLElement>) => void; onSubtaskDrop?: (before?: number) => boolean;
}) {
  const subtaskListId = useId();
  const task = group.parent, tint = task || group.matches[0] || group.children[0];
  const selectable = new Set(group.matches.map((task) => task.id));
  const children = filterSubtasks ? group.children.filter((child) => selectable.has(child.id)) : group.children;
  const comments = task?.comments?.slice(0, 2) || [];
  const open = () => { if (task) onOpen(task.id); };
  const isOpen = task?.id === selectedId || group.children.some((child) => child.id === selectedId);
  const reminderFired = Boolean(task && hasFiredReminder(task)) || group.children.some(hasFiredReminder);
  return <article className={`task-card priority-surface-${tint.priority} ${task && checked.has(task.id) ? "checked" : ""} ${isOpen ? "task-open" : ""} ${reminderFired ? "reminder-due" : ""}`} data-task-key={task?.jiraKey || group.key} draggable={Boolean(onDragStart && task && !disabled && !task.archived)} onDragStart={(event) => { event.stopPropagation(); if (task) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); onDragStart?.(task.id); } }} onDragEnd={onDragEnd} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={onDrop} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,select,textarea,label,summary") && !window.getSelection()?.toString()) open(); }}>
    {task ? <>
      <div className="card-top"><input type="checkbox" aria-label={`Select ${task.title}`} checked={checked.has(task.id)} disabled={disabled || !selectable.has(task.id)} onChange={() => onToggle(task.id)} /><span className={`priority priority-${task.priority}`}>{PRIORITIES[task.priority]}</span><span className="source-label issue-links">{task.source === "jira" ? <><JiraTaskLink jiraKey={task.jiraKey} onOpen={open} disabled={disabled} /><WebJiraLink jiraKey={task.jiraKey} href={task.jiraUrl} /></> : "Local"}</span><TaskAgeBadge task={task} /></div>
      <button type="button" className="task-title" aria-current={task.id === selectedId ? "true" : undefined} onClick={open}>{task.title}</button>
      {task.tags?.length ? <div className="card-tags" aria-label={`Tags on ${task.title}`}>{task.tags.map((tag) => <button type="button" key={tag.id} onClick={() => onTagFilter(tag.id)} title={`Filter by ${tag.name}`}>{tag.name}</button>)}</div> : null}
      {isOpen ? <span className="open-indicator">{task.id === selectedId ? "Open task" : "Open subtask"}</span> : null}
      {reminderFired ? <span className="reminder-indicator">{hasFiredReminder(task) ? "Reminder fired" : "Subtask reminder fired"}</span> : null}
      {!selectable.has(task.id) ? <small className="context-parent">Parent shown for context · {task.state || (task.archived ? "Done" : "Active")}</small> : null}
      {task.syncStatus !== "synced" && task.source === "jira" ? <p className={`sync-badge ${task.syncStatus === "attention" ? "needs-attention" : ""}`} title={task.syncError}>{task.syncStatus === "attention" ? "Sync needs attention" : "Saved locally · Pending sync"}</p> : null}
      {task.notes ? <p className="notes-preview">{task.notes}</p> : null}
      {comments.length ? <section className="card-comments" aria-label={`Recent comments on ${task.title}`}><h3>Recent comments</h3>{comments.map((comment) => <div className="card-comment" key={comment.id}><small>{comment.author}{comment.updatedAt ? ` · ${formatDate(comment.updatedAt)}` : ""}{comment.pending ? " · Pending sync" : ""}</small><p><LinkedText text={comment.body} /></p></div>)}</section> : null}
    </> : <h3 className="orphan-heading">Subtasks · {group.key === "parent:unavailable" ? "Parent not cached" : group.key.replace(/^parent:/, "")}</h3>}
    {children.length ? <section className="card-subtasks" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={onSubtaskDrop ? (event) => { event.preventDefault(); event.stopPropagation(); if (!onSubtaskDrop()) onDrop?.(event); } : undefined} aria-label={`Subtasks of ${task?.title || "uncached parent"}`}><button type="button" className="subtask-disclosure" aria-expanded={!subtasksCollapsed} aria-controls={subtaskListId} aria-label={`${subtasksCollapsed ? "Expand" : "Collapse"} subtasks of ${task?.title || "uncached parent"}`} onClick={onToggleSubtasks}><span className="subtask-chevron" aria-hidden="true">{subtasksCollapsed ? "▸" : "▾"}</span><span>Subtasks{filterSubtasks && children.length < group.children.length ? ` · ${children.length} matching` : ""}</span><span className="subtask-count">{group.children.filter((child) => child.archived).length}/{group.children.length} done</span></button><div id={subtaskListId} hidden={subtasksCollapsed}>{children.map((child) => <div className={`card-subtask priority-surface-${child.priority} ${child.archived ? "subtask-done" : ""} ${child.id === selectedId ? "subtask-open" : ""}`} data-task-key={child.jiraKey} key={child.id} onDragEnter={(event) => event.preventDefault()} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }} draggable={Boolean(onDragStart && !disabled && !task?.archived)} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(child.id)); onDragStart?.(child.id); }} onDragEnd={(event) => { event.stopPropagation(); onDragEnd?.(); }} onDrop={onSubtaskDrop ? (event) => { event.preventDefault(); event.stopPropagation(); if (!onSubtaskDrop(child.id)) onDrop?.(event); } : undefined}>
      <div className="subtask-line"><input type="checkbox" aria-label={`Select ${child.title}`} checked={checked.has(child.id)} disabled={disabled || !selectable.has(child.id)} onChange={() => onToggle(child.id)} /><JiraTaskLink jiraKey={child.jiraKey} onOpen={() => onOpen(child.id)} disabled={disabled} /><span className="subtask-separator" aria-hidden="true">|</span><button type="button" className="subtask-title" aria-current={child.id === selectedId ? "true" : undefined} onClick={() => onOpen(child.id)}>{child.title}</button><TaskAgeBadge task={child} compact /></div>
      <div className="subtask-meta"><span className="subtask-state">{child.archived ? "✓ " : ""}{child.state || (child.archived ? "Done" : "Active")}</span><WebJiraLink jiraKey={child.jiraKey} href={child.jiraUrl} /></div>
      {child.tags?.length ? <div className="card-tags" aria-label={`Tags on ${child.title}`}>{child.tags.map((tag) => <button type="button" key={tag.id} onClick={() => onTagFilter(tag.id)} title={`Filter by ${tag.name}`}>{tag.name}</button>)}</div> : null}
      {child.notifyAt ? <small className="subtask-reminder">{hasFiredReminder(child) ? "Reminder fired" : "Reminder"} · {formatDate(child.notifyAt)}</small> : null}
      {child.syncStatus !== "synced" ? <small className="subtask-pending">{child.syncStatus === "attention" ? "Sync needs attention" : "Pending sync"}</small> : null}
      {child.comments?.[0] ? <p className="subtask-comment"><strong>{child.comments[0].author}:</strong> <LinkedText text={child.comments[0].body} /></p> : null}
    </div>)}</div></section> : null}
    {task ? <>
      {task.dueDate ? <p className="task-due">Due {task.dueDate}</p> : null}
      <div className="card-footer"><span>{task.notifyAt ? `${hasFiredReminder(task) ? "Reminder fired" : "Reminder"} · ${formatDate(task.notifyAt)}` : task.state ?? ""}</span><button type="button" onClick={() => onMove(task)} disabled={disabled} aria-label={`${task.archived ? "Restore" : "Mark done"}: ${task.title}`}>{task.archived ? "Restore" : "Done"}</button></div>
    </> : <p className="muted">The parent is outside the cached board. Open a subtask to view its details.</p>}
  </article>;
}
