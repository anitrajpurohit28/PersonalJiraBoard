"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { orderNamedOptions, uiSettings } from "../../config/ui-settings.mjs";
import { jiraPriorityButtons } from "../../lib/jira-fields.mjs";
import { cachedTaskEditor } from "../../lib/jira-editor-state";
import { COLUMNS, PRIORITY_OPTIONS, type JiraEditorContext, type JiraSession, type Task } from "../../lib/task-types";
import type { TaskArea } from "../../lib/task-areas";
import { requestJson } from "./api";

export type TaskMenuTarget = { taskId: number; x: number; y: number; origin: HTMLElement };
export function TaskContextMenu({ target, task, session, areas, onClose, onOpen, onAddSubtask, onMove, onSetArea, onUpdate, onDelete }: {
  target: TaskMenuTarget; task: Task; session: JiraSession | null; areas: TaskArea[];
  onClose: () => void; onOpen: () => void; onAddSubtask: () => void;
  onMove: (status: string) => void; onSetArea: (id: string | null) => void;
  onUpdate: (payload: Record<string, unknown>) => void; onDelete: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const [context, setContext] = useState<JiraEditorContext | null>(() => cachedTaskEditor(task, session));
  const [error, setError] = useState("");
  const latestClose = useRef(onClose);
  useEffect(() => { latestClose.current = onClose; });
  useLayoutEffect(() => {
    const bounds = menu.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)) });
  }, [target.x, target.y, context, areas.length, error]);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node)) latestClose.current(); };
    const resize = () => latestClose.current();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", outside, true); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    if (task.source !== "jira") return;
    let cancelled = false;
    void requestJson(`/api/jira/edit-meta?key=${encodeURIComponent(task.jiraKey)}`).then((next: JiraEditorContext) => { if (!cancelled) setContext(next); }).catch(() => { if (!cancelled) setError("Using cached options. Open details if a change needs attention."); });
    return () => { cancelled = true; };
  }, [task.source, task.jiraKey]);
  function act(action: () => void) { onClose(); action(); }
  const raw = context?.issue?.fields;
  const priorities = task.source === "jira" ? jiraPriorityButtons(context?.fields.find((field) => field.fieldId === "priority")?.allowedValues || [], raw?.priority || task.jiraPriorityId) : { options: PRIORITY_OPTIONS, value: String(task.priority === 1 ? 2 : task.priority) };
  const currentStatus = String((raw?.status as { id?: string })?.id || task.jiraStatusId || "");
  const statuses = task.source === "jira" ? (context?.transitions || []).filter((transition) => transition.to.category !== "done" && transition.to.id !== currentStatus).map((transition) => ({ id: transition.to.id, name: transition.to.name, needsFields: transition.fields.some((field) => field.required && !field.hasDefaultValue && !["assignee", "reporter"].includes(field.fieldId)) })) : COLUMNS.map((column) => ({ id: column.id, name: column.label, needsFields: false }));
  if (task.source === "jira" && !task.archived && currentStatus && !statuses.some((status) => status.id === currentStatus)) statuses.unshift({ id: currentStatus, name: (raw?.status as { name?: string })?.name || task.state || "Current", needsFields: false });
  return createPortal(<div ref={menu} className="task-context-menu" role="dialog" aria-label={`Actions for ${task.jiraKey || task.title}`} style={position} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); target.origin.focus(); onClose(); }
    else if (event.key === "Tab") onClose();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <header><small>{task.jiraKey || "Local task"}</small><strong title={task.title}>{task.title}</strong></header>
    <button type="button" className="context-action" onClick={() => act(onOpen)}>Open details <span aria-hidden="true">↵</span></button>
    {statuses.length ? <section aria-label="Move to"><h3>Move to</h3><div className="context-options">{orderNamedOptions(statuses, uiSettings.statusOrder).map((status) => <button type="button" key={status.id} title={status.needsFields ? "Open task details to supply required transition fields" : undefined} aria-pressed={task.source === "jira" ? currentStatus === status.id : task.status === status.id} onClick={() => act(status.needsFields ? onOpen : () => (task.source === "jira" ? currentStatus === status.id : task.status === status.id) ? undefined : task.source === "jira" ? onUpdate({ targetStatusId: status.id, expectedUpdatedAt: task.jiraUpdatedAt }) : onMove(status.id))}>{status.name}</button>)}</div></section> : null}
    {priorities.options.length ? <section aria-label="Priority"><h3>Priority</h3><div className="context-options">{orderNamedOptions(priorities.options, uiSettings.priorityOrder).map((priority) => <button type="button" key={priority.id} aria-pressed={priorities.value === priority.id} onClick={() => act(() => onUpdate(task.source === "jira" ? { fields: { priority: priority.id }, baseFields: { priority: raw?.priority || { id: task.jiraPriorityId } }, expectedUpdatedAt: task.jiraUpdatedAt } : { priority: Number(priority.id) }))}>{priority.name}</button>)}</div></section> : null}
    {areas.length && !task.parentKey && !task.isSubtask ? <section aria-label="Area"><h3>Area</h3><div className="context-options">{[{ id: "", name: "Unassigned" }, ...areas.filter((area) => !area.disabled)].map((area) => <button type="button" key={area.id} aria-pressed={(task.areaId || "") === area.id} onClick={() => act(() => onSetArea(area.id || null))}>{area.name}</button>)}</div></section> : null}
    <section className="context-actions">
      <button type="button" className="context-action" onClick={() => act(() => onMove(task.archived ? "restore" : "done"))}>{task.archived ? "Restore task" : "Mark as Done"}<span aria-hidden="true">✓</span></button>
      {task.source === "jira" && !task.isSubtask && !task.parentKey ? <button type="button" className="context-action" onClick={() => act(onAddSubtask)}>Add subtask <span aria-hidden="true">+</span></button> : null}
      {task.jiraUrl ? <a className="context-action" href={task.jiraUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}>Open in WebJira <span aria-hidden="true">↗</span></a> : null}
    </section>
    {error ? <p className="context-hint">{error}</p> : null}
    <button type="button" className="context-action context-delete" onClick={() => act(onDelete)}>Delete task</button>
  </div>, document.body);
}
