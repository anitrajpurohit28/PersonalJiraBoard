"use client";

import { useEffect, useRef, useState, useId, type FormEvent } from "react";
import { settings } from "../../config/settings.mjs";
import { uiSettings } from "../../config/ui-settings.mjs";
import { adfText, descriptionText, CORE_JIRA_FIELDS, jiraPriorityButtons, inheritedPriority } from "../../lib/jira-fields.mjs";
import type { JiraField, JiraEditorContext, JiraSession, Task } from "../../lib/task-types";
import { TaskModal, localDateTime } from "./TaskModal";
import { requestJson } from "./api";
import { JiraUploadedFiles } from "./JiraUploadedFiles";
import { Fragment } from "react";
import { JiraActivity } from "./JiraActivity";
import { WorkflowButtons } from "./WorkflowButtons";
import { ChoiceButtons } from "./ChoiceButtons";
import { useTaskAutosave } from "./useTaskAutosave";
import { TaskDateField } from "./TaskDateField";
import { ReminderField } from "./ReminderField";
import { JiraTaskLink, WebJiraLink } from "./JiraTaskLink";
import type { DetailPosition } from "./useDetailPosition";
import { orderSubtasks } from "../../lib/board-tasks";
import { TaskTags } from "./TaskTags";
import type { TaskTag } from "../../lib/task-tags";
import type { TaskArea as Area } from "../../lib/task-areas";
import { TaskArea } from "./TaskArea";
import { DescriptionField } from "./DescriptionField";
import { LinkedTextField } from "./LinkedText";
import { cachedTaskEditor } from "../../lib/jira-editor-state";

type Context = JiraEditorContext;
const CORE = CORE_JIRA_FIELDS;
const HIDDEN = ["project", "issuetype", "assignee", "reporter", "labels"];
const idOf = (value: unknown): string => typeof value === "object" && value ? String((value as { id?: string; value?: string; accountId?: string }).id || (value as { value?: string }).value || (value as { accountId?: string }).accountId || "") : String(value ?? "");
function initialValue(field: JiraField, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (field.fieldId === "description") return descriptionText(raw);
  if (["environment"].includes(field.fieldId) || field.schema.custom?.endsWith(":textarea")) return adfText(raw).trimEnd();
  if (field.fieldId === "parent") return typeof raw === "object" && raw ? (raw as { key?: string }).key || "" : raw;
  if (field.schema.type === "array") return Array.isArray(raw) ? raw.map((value) => typeof value === "object" ? idOf(value) : value) : [];
  if (field.schema.type === "user" || field.allowedValues.length) return idOf(raw);
  return raw ?? "";
}
function normalizeValues(values: Record<string, unknown>, fields: JiraField[]) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => {
    const field = fields.find((field) => field.fieldId === key);
    return [key, field?.schema.type === "array" && field.schema.items === "string" && typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value];
  }));
}
function defaultValues(fields: JiraField[], parentPriority?: unknown) {
  const values = Object.fromEntries(fields.filter((field) => !HIDDEN.includes(field.fieldId)).map((field) => [field.fieldId, initialValue(field, field.defaultValue)]));
  const priority = fields.find((field) => field.fieldId === "priority");
  const inherited = priority && inheritedPriority(priority.allowedValues, parentPriority);
  if (inherited) values.priority = inherited;
  return values;
}

export function JiraFieldInput({ field, value, onChange, accountId, disabled, currentAssignee, formId, autoFocus = false }: {
  field: JiraField; value: unknown; onChange: (value: unknown) => void; accountId: string; disabled: boolean; currentAssignee?: string | null; formId?: string; autoFocus?: boolean;
}) {
  if (["assignee", "reporter"].includes(field.fieldId)) return null;
  const required = field.required && !field.hasDefaultValue;
  const label = `${field.name}${required ? " *" : ""}`;
  if (field.schema.type === "user" || ["assignee", "reporter"].includes(field.fieldId)) {
    return <label>{label}<select value={value === undefined ? "__default__" : String(value || "")} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value === "__default__" ? undefined : event.target.value)}>
      <option value="__default__">Jira default</option>{!required ? <option value="">Unassigned</option> : null}<option value={accountId}>Me ({settings.email})</option>
      {typeof value === "string" && value && value !== accountId ? <option value={value}>{currentAssignee || "Current assignee"}</option> : null}
    </select></label>;
  }
  if (field.allowedValues.length) {
    const multiple = field.schema.type === "array";
    const options = field.allowedValues.map((option) => typeof option === "object" ? { value: String(option.id || option.value), label: option.name || option.value || String(option.id) } : { value: option, label: option });
    if (field.fieldId === "priority") return <ChoiceButtons label={label} order={uiSettings.priorityOrder} {...jiraPriorityButtons(field.allowedValues, value)} disabled={disabled} onChange={onChange} />;
    return <label>{label}<select multiple={multiple} required={required} disabled={disabled} value={multiple ? (Array.isArray(value) ? value.map(String) : []) : idOf(value)} onChange={(event) => onChange(multiple ? Array.from(event.target.selectedOptions).map((option) => option.value) : event.target.value)}>
      {!multiple ? <option value="">{field.hasDefaultValue ? "Jira default" : "Choose…"}</option> : null}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>;
  }
  if (field.fieldId === "description") return <DescriptionField label={label} value={String(value || "")} required={required} disabled={disabled} onChange={onChange} />;
  if (["description", "environment"].includes(field.fieldId) || field.schema.custom?.endsWith(":textarea")) return <LinkedTextField label={label} value={String(value || "")} required={required} disabled={disabled} onChange={onChange} />;
  if (field.schema.type === "boolean") return <label><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
  const isNumber = ["number", "integer"].includes(field.schema.type || "");
  const type = field.schema.type === "date" || field.fieldId === "duedate" ? "date" : field.schema.type === "datetime" ? "datetime-local" : isNumber ? "number" : "text";
  const supported = [undefined, "string", "number", "integer", "date", "datetime"].includes(field.schema.type) || field.fieldId === "parent" || (field.schema.type === "array" && field.schema.items === "string");
  if (!supported) return <p className="field-warning">{field.name} needs a field type this app cannot edit. Create this issue in Jira to set it.</p>;
  return <label>{label}<input form={formId} autoFocus={autoFocus} type={type} step={field.schema.type === "number" ? "any" : undefined} maxLength={field.fieldId === "summary" ? 255 : undefined} required={required} disabled={disabled} value={type === "datetime-local" ? localDateTime(typeof value === "string" && value ? value : null) : Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value)} placeholder={field.fieldId === "parent" ? "e.g. KAN-2" : field.fieldId === "labels" ? "Comma-separated labels" : undefined} onInput={type === "date" ? (event) => onChange(event.currentTarget.value) : undefined} onChange={(event) => onChange(type === "datetime-local" ? event.target.value ? new Date(event.target.value).toISOString() : "" : field.fieldId === "parent" ? event.target.value.toUpperCase() : event.target.value)} /></label>;
}

export function JiraTaskEditor({ task, parentTask, tasks, session, busy, available, connected, serverError, onClose, onSave, onDelete, onAddSubtask, onRenameSubtask, onOpenTask, onChanged, position, onTogglePosition, tags, onManageTags, tagShortcutsEnabled, taggingId, onSetTaskTag, areas, defaultAreaId, onManageAreas, onSetArea }: {
  areas: Area[]; defaultAreaId: string | null; onManageAreas: () => void; onSetArea: (task: Task, id: string | null) => void;
  tags: TaskTag[]; onManageTags: () => void; tagShortcutsEnabled: boolean; taggingId: number | null; onSetTaskTag: (task: Task, id: string, assigned: boolean) => void;
  task?: Task; parentTask?: Task; tasks: Task[]; session?: JiraSession | null; busy: boolean; available: boolean; connected: boolean; serverError: string; onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>; onDelete?: () => Promise<void>;
  onRenameSubtask?: (task: Task, title: string, baseSummary: string) => Promise<boolean>;
  onAddSubtask?: (parent: Task) => void; onOpenTask?: (id: number) => void; onChanged: () => Promise<void>; position: DetailPosition; onTogglePosition: () => void;
}) {
  // null follows the parent's labels until the user customizes this draft.
  const [newTagIds, setNewTagIds] = useState<string[] | null>(null);
  const [newAreaId, setNewAreaId] = useState<string | null>(parentTask?.areaId || defaultAreaId);
  const [cached] = useState(() => cachedTaskEditor(task, session));
  const [context, setContext] = useState<Context | null>(cached);
  const [project, setProject] = useState(task?.projectId || parentTask?.projectId || "");
  const [issueType, setIssueType] = useState(task?.issueTypeId || "");
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries((cached?.fields || []).filter((field) => CORE.includes(field.fieldId)).map((field) => [field.fieldId, initialValue(field, cached?.issue?.fields[field.fieldId])])));
  const initial = useRef<Record<string, unknown>>(values);
  const rawInitial = useRef<Record<string, unknown>>(cached?.issue?.fields || {});
  const priorityChosen = useRef(false);
  const dirty = useRef(false), loadedSelection = useRef("");
  const requestId = useRef(crypto.randomUUID());
  const created = useRef(false);
  const [loading, setLoading] = useState(available);
  const [loadError, setLoadError] = useState("");
  const [notifyAt, setNotifyAt] = useState(localDateTime(task?.notifyAt || null));
  const reminderInitial = useRef(localDateTime(task?.notifyAt || null));
  const [target, setTarget] = useState("");
  const [transitionFields, setTransitionFields] = useState<Record<string, unknown>>({});
  const form = useRef<HTMLFormElement>(null);
  const [validationError, setValidationError] = useState("");
  const [closing, setClosing] = useState(false);
  const [children, setChildren] = useState<Array<{ requestId: string; fields: Record<string, unknown> }>>([]);
  const [childContext, setChildContext] = useState<Context | null>(null);
  const [subtaskTitles, setSubtaskTitles] = useState<Record<number, string>>({});
  const subtaskInitial = useRef<Record<number, string>>({});
  const taskKey = task?.jiraKey, parentKey = parentTask?.jiraKey;
  const parentPriorityId = parentTask?.jiraPriorityId, parentPriorityName = parentTask?.jiraPriority;

  useEffect(() => {
    if (!available) return;
    const selection = `${taskKey || "new"}:${project}:${issueType}:${parentKey || ""}`;
    if (loadedSelection.current === selection) return;
    let cancelled = false;
    void (async () => {
      setLoading(true); setLoadError("");
      try {
        const url = taskKey ? `/api/jira/edit-meta?key=${encodeURIComponent(taskKey)}` : `/api/jira/create-meta?projectId=${encodeURIComponent(project)}&issueTypeId=${encodeURIComponent(issueType)}&parentKey=${encodeURIComponent(parentKey || "")}`;
        const next = await requestJson(url) as Context;
        if (cancelled) return;
        if (!taskKey) {
          if (!next.project || !next.issueType || !next.projects || !next.issueTypes) throw new Error("Jira did not provide the fields needed to create this task. Try connecting again.");
          loadedSelection.current = `new:${next.project.id}:${next.issueType.id}:${parentKey || ""}`;
          setProject(next.project.id); setIssueType(next.issueType.id);
          setValues((current) => ({ ...defaultValues(next.fields, parentKey ? { id: parentPriorityId, name: parentPriorityName } : undefined), ...Object.fromEntries(Object.entries(current).filter(([, value]) => value !== undefined)) }));
        } else {
          loadedSelection.current = selection;
          if (!dirty.current) {
            const fields = next.issue?.fields || {};
            const entries = Object.fromEntries(next.fields.filter((field) => CORE.includes(field.fieldId)).map((field) => [field.fieldId, initialValue(field, fields[field.fieldId])]));
            initial.current = entries; rawInitial.current = fields; setValues(entries);
          }
        }
        setContext(next); setLoading(false);
        if (taskKey && connected) {
          try {
            const fresh = await requestJson(`${url}&refresh=1`) as Context;
            if (cancelled) return;
            if (!dirty.current) {
              const fields = fresh.issue?.fields || {};
              const entries = Object.fromEntries(fresh.fields.filter((field) => CORE.includes(field.fieldId)).map((field) => [field.fieldId, initialValue(field, fields[field.fieldId])]));
              initial.current = entries; rawInitial.current = fields; setValues(entries);
            }
            setContext(fresh);
          } catch { /* Cached edits remain available while Jira is unreachable. */ }
        }
      } catch (error) { if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load cached Jira fields."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [available, connected, taskKey, project, issueType, parentKey, parentPriorityId, parentPriorityName]);

  useEffect(() => {
    if (!context || !children.length || childContext?.project?.id === project) return;
    const childType = context.issueTypes?.find((type) => type.subtask);
    if (!childType) return;
    let cancelled = false;
    void requestJson(`/api/jira/create-meta?projectId=${encodeURIComponent(project)}&issueTypeId=${encodeURIComponent(childType.id)}`).then((next: Context) => {
      if (cancelled) return;
      setChildContext(next); setChildren((current) => current.map((child) => ({ ...child, fields: { ...defaultValues(next.fields), ...child.fields } })));
    }).catch((error) => { if (!cancelled) setLoadError(error.message); });
    return () => { cancelled = true; };
  }, [context, project, children.length, childContext?.project?.id]);

  const isSubtask = task ? Boolean(task.isSubtask || (context?.issue?.fields.issuetype as { subtask?: boolean })?.subtask) : Boolean(parentTask || context?.issueType?.subtask);
  const creationParent = !task ? parentTask || tasks.find((row) => row.jiraKey === values.parent) : undefined;
  const inheritedTagIds = (creationParent?.tags || []).map((tag) => tag.id);
  const fields = (context?.fields || []).filter((field) => field.fieldId !== session?.metadata?.areaCatalog?.fieldId && !HIDDEN.includes(field.fieldId) && (field.fieldId !== "parent" || (isSubtask && !parentTask)) && (CORE.includes(field.fieldId) || (!task && field.required && !field.hasDefaultValue)))
    .sort((a, b) => (CORE.indexOf(a.fieldId) < 0 ? 100 : CORE.indexOf(a.fieldId)) - (CORE.indexOf(b.fieldId) < 0 ? 100 : CORE.indexOf(b.fieldId)));
  const transition = context?.transitions?.find((transition) => transition.to.id === target);
  const requiredTransitionFields = transition?.fields.filter((field) => !HIDDEN.includes(field.fieldId) && field.required && !field.hasDefaultValue) || [];
  const childFields = childContext?.fields.filter((field) => field.fieldId !== session?.metadata?.areaCatalog?.fieldId && !HIDDEN.includes(field.fieldId) && field.fieldId !== "parent" && (["summary", "description", "priority"].includes(field.fieldId) || (field.required && !field.hasDefaultValue)))
    .sort((a, b) => (CORE.indexOf(a.fieldId) < 0 ? 100 : CORE.indexOf(a.fieldId)) - (CORE.indexOf(b.fieldId) < 0 ? 100 : CORE.indexOf(b.fieldId))) || [];
  const subtasks = task ? orderSubtasks(tasks.filter((child) => child.parentKey === task.jiraKey)) : [];
  const activeSubtasks = subtasks.filter((child) => !child.archived), completedSubtasks = subtasks.filter((child) => child.archived);
  // Use SQL task IDs so temporary Jira keys never duplicate a child.

  function draft() {
    if (loading || created.current) return null;
    const normalized = normalizeValues(values, context?.fields || []);
    const fieldsToSave = Object.fromEntries(Object.entries(normalized).filter(([key, value]) => !HIDDEN.includes(key) && key !== session?.metadata?.areaCatalog?.fieldId && (key !== "parent" || isSubtask) && (!task || JSON.stringify(value) !== JSON.stringify(initial.current[key]))));
    const targetStatusId = target && target !== String((rawInitial.current.status as { id?: string })?.id || task?.jiraStatusId) ? target : undefined;
    const reminderFields = notifyAt !== reminderInitial.current || !task ? { notifyAt: notifyAt ? new Date(notifyAt).toISOString() : null } : {};
    const renames = tasks.filter((child) => child.parentKey === task?.jiraKey && subtaskTitles[child.id] !== undefined && subtaskTitles[child.id].trim() !== subtaskInitial.current[child.id])
      .map((child) => ({ task: child, title: subtaskTitles[child.id].trim(), baseSummary: subtaskInitial.current[child.id] }));
    const saveTask = !task || Boolean(Object.keys(fieldsToSave).length || targetStatusId || Object.keys(reminderFields).length);
    if (!saveTask && !renames.length) return null;
    const payload = task ? { fields: fieldsToSave, baseFields: rawInitial.current, expectedUpdatedAt: rawInitial.current.updated, targetStatusId, transitionFields: normalizeValues(transitionFields, transition?.fields || []) } : { requestId: requestId.current, projectId: project, issueTypeId: issueType, parentKey, areaId: areas.some((area) => area.id === newAreaId) ? newAreaId : null, tagIds: newTagIds?.filter((id) => tags.some((tag) => tag.id === id)), fields: fieldsToSave, subtasks: children.map((child) => ({ requestId: child.requestId, fields: normalizeValues(child.fields, childContext?.fields || []) })) };
    return { payload: { ...payload, ...reminderFields }, normalized, notifyAt, status: targetStatusId ? transition?.to : undefined, saveTask, renames };
  }

  const autosave = useTaskAutosave(JSON.stringify({ values, notifyAt, target, transitionFields, subtaskTitles }), Boolean(task && !loading), draft, async (snapshot) => {
    if (!form.current?.checkValidity() || (!task && (!context || !available || loadError || (children.length > 0 && !childContext)))) {
      setValidationError("Complete the required fields to save your changes."); return false;
    }
    const required = [...fields, ...requiredTransitionFields].find((field) => field.required && !field.hasDefaultValue && !HIDDEN.includes(field.fieldId) && !(field.fieldId in transitionFields ? transitionFields[field.fieldId] : snapshot.normalized[field.fieldId]));
    if (required) { setValidationError(`${required.name} is required.`); return false; }
    if (snapshot.renames.some((child) => !child.title || child.title.length > 255)) { setValidationError("Each subtask needs a title of 1–255 characters."); return false; }
    setValidationError("");
    if (snapshot.saveTask) {
      if (!await onSave(snapshot.payload)) return false;
      if (!task) created.current = true;
      initial.current = snapshot.normalized;
      rawInitial.current = { ...rawInitial.current, ...snapshot.payload.fields, ...(snapshot.status ? { status: snapshot.status } : {}) };
      reminderInitial.current = snapshot.notifyAt;
      if (snapshot.status) {
        setContext((current) => current ? { ...current, issue: current.issue ? { ...current.issue, fields: { ...current.issue.fields, status: snapshot.status } } : undefined } : current);
        setTarget((current) => current === snapshot.status?.id ? "" : current);
      }
    }
    for (const child of snapshot.renames) {
      if (!onRenameSubtask || !await onRenameSubtask(child.task, child.title, child.baseSummary)) return false;
      subtaskInitial.current[child.task.id] = child.title;
    }
    return true;
  });

  async function leave(next = onClose) {
    if (closing) return;
    if (!task && !String(values.summary || "").trim() && !notifyAt && !children.length && !String(values.description || "").trim()) { next(); return; }
    if (loading) { if (task && notifyAt === reminderInitial.current) next(); return; }
    setClosing(true);
    try { if (await autosave.flush()) next(); else form.current?.reportValidity(); }
    finally { setClosing(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void leave(); }

  // Background autosave must not disable a focused input: doing so blurs it and
  // closes the description editor. The autosave controller serializes newer drafts.
  const fieldBusy = busy && autosave.state !== "saving";
  const formId = useId();
  const dueField = fields.find((field) => field.fieldId === "duedate");
  const dueControl = dueField ? <section className="task-due-section" aria-label="Due date"><TaskDateField label="Due date" value={String(values.duedate || "")} required={dueField.required && !dueField.hasDefaultValue} disabled={fieldBusy || loading || !available || Boolean(loadError)} onChange={(value) => { dirty.current = true; setValues((current) => ({ ...current, duedate: value })); }} /></section> : null;
  const currentStatus = context?.issue?.fields.status as { id?: string; name?: string } | undefined;
  const currentStatusId = String(currentStatus?.id || task?.jiraStatusId || "current");
  const reminderControl = <ReminderField value={task?.archived && !target ? "" : notifyAt} onChange={setNotifyAt} fired={Boolean(task?.notifyFired && task.notifyAt && localDateTime(task.notifyAt) === notifyAt)} formId={formId} disabled={fieldBusy || loading || Boolean(task?.archived && !target) || transition?.to.category === "done"} />;
  const formActions = <div className="form-actions">{task ? <span className={`save-status save-${autosave.state}`} role="status">{autosave.state === "saving" ? "Saving…" : autosave.state === "error" ? "Not saved · fix the error and retry" : autosave.state === "unsaved" ? "Unsaved changes" : "Changes saved automatically"}</span> : <button type="button" disabled={busy} onClick={onClose}>Cancel</button>}<button type="submit" form={formId} className="primary" disabled={closing || loading || (children.length > 0 && !childContext) || (!task && (!context || Boolean(loadError) || !available))}>{closing ? "Saving…" : task ? autosave.state === "error" ? "Retry save" : "Done" : parentTask ? "Create subtask" : "Create task"}</button></div>;
  function renderSubtask(row: Task) {
    return <div className={`subtask-row ${row.archived ? "subtask-done" : ""}`} key={row.id} data-task-key={row.jiraKey}>
      <div className="subtask-identity">
        <div className="subtask-edit-line"><JiraTaskLink jiraKey={row.jiraKey} disabled={closing} onOpen={() => void leave(() => onOpenTask?.(row.id))} /><span className="subtask-separator" aria-hidden="true">|</span>
        {onRenameSubtask ? <input className="subtask-inline-title" aria-label={`Subtask title (${row.jiraKey})`} title="Rename subtask" form={formId} required maxLength={255} disabled={fieldBusy || loading || !available} value={subtaskTitles[row.id] ?? row.title} onChange={(event) => {
          if (!(row.id in subtaskInitial.current)) subtaskInitial.current[row.id] = row.title;
          setSubtaskTitles((current) => ({ ...current, [row.id]: event.target.value }));
        }} onBlur={() => void autosave.flush()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void autosave.flush(); } }} /> : <span className="subtask-title">{row.title}</span>}</div>
        <div className="subtask-meta"><small>{row.archived ? "✓ " : ""}{row.state}{row.syncStatus !== "synced" ? " · Pending sync" : ""}</small><WebJiraLink jiraKey={row.jiraKey} href={row.jiraUrl} /></div>
      </div>
    </div>;
  }
  return <TaskModal position={position} onTogglePosition={onTogglePosition} title={task ? `${task.jiraUrl ? task.jiraKey : "Pending task"} · Task details` : parentTask ? "New subtask" : "New task"} busy={closing || (busy && autosave.state !== "saving")} onClose={() => void leave()}>
    <form ref={form} id={formId} onSubmit={submit}>
      {serverError || loadError ? <p className="notice error" role="alert">{loadError || serverError}</p> : null}
      {validationError && autosave.state === "error" ? <p className="notice error" role="alert">{validationError}</p> : null}
      {loading && !context ? <p role="status">Loading task fields…</p> : null}
      {!connected ? <p className="offline-note">Offline changes are saved on this device and sync when Jira is available.</p> : null}
      {!task && context?.project ? <div className="form-grid">{(context.projects?.length || 0) > 1 ? <label>Project<select value={project} disabled={fieldBusy || loading} onChange={(event) => { loadedSelection.current = ""; setProject(event.target.value); setIssueType(""); setChildren([]); }}>{context.projects?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : <p className="jira-context">{context.project.name}</p>}{!parentTask ? <label>Issue type<select value={issueType} disabled={fieldBusy || loading} onChange={(event) => { loadedSelection.current = ""; setIssueType(event.target.value); setChildren([]); }}>{context.issueTypes?.filter((type) => !/^epic$/i.test(type.name)).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label> : null}</div> : null}
      {parentTask ? <p className="jira-context">Subtask of <JiraTaskLink jiraKey={parentTask.jiraKey} onOpen={() => void leave()} /> · <strong>{parentTask.title}</strong> <WebJiraLink jiraKey={parentTask.jiraKey} href={parentTask.jiraUrl} /></p> : null}
      {task ? <p className="jira-context issue-links"><JiraTaskLink jiraKey={task.jiraKey} onOpen={() => void leave(() => onOpenTask?.(task.id))} /><span>· {task.projectKey} · {task.issueType}</span><WebJiraLink jiraKey={task.jiraKey} href={task.jiraUrl} /></p> : null}
      {!context && task ? <p><strong>{task.title}</strong></p> : null}
      <fieldset disabled={fieldBusy || loading || !available || Boolean(loadError)}>{fields.filter((field) => field.fieldId !== "duedate").map((field) => <Fragment key={field.fieldId}><JiraFieldInput key={field.fieldId} field={field} value={values[field.fieldId]} autoFocus={!task && field.fieldId === "summary"} accountId={context?.accountId || ""} disabled={fieldBusy || loading} onChange={(value) => {
        dirty.current = true;
        if (field.fieldId === "priority") priorityChosen.current = true;
        const parent = !task && field.fieldId === "parent" ? tasks.find((row) => row.jiraKey === value) : undefined;
        const priorityField = context?.fields.find((entry) => entry.fieldId === "priority");
        const inherited = parent && priorityField && !priorityChosen.current ? inheritedPriority(priorityField.allowedValues, { id: parent.jiraPriorityId, name: parent.jiraPriority }) : undefined;
        setValues((current) => ({ ...current, [field.fieldId]: value, ...(inherited ? { priority: inherited } : {}) }));
      }} />{field.fieldId === "description" && task ? <JiraUploadedFiles taskId={task.id} onChanged={onChanged} /> : null}</Fragment>)}
      {task && context ? <WorkflowButtons options={[{ id: currentStatusId, name: currentStatus?.name || task.state || "Current" }, ...(context.transitions || []).map((entry) => ({ id: entry.to.id, name: entry.to.name }))]} value={target || currentStatusId} disabled={busy} onChange={(value) => { dirty.current = true; setTarget(value === currentStatusId ? "" : value); if (context.transitions?.find((entry) => entry.to.id === value)?.to.category === "done") setNotifyAt(""); setTransitionFields({}); }} /> : null}
      {requiredTransitionFields.map((field) => <JiraFieldInput key={field.fieldId} field={field} value={transitionFields[field.fieldId]} accountId={context?.accountId || ""} disabled={busy} onChange={(value) => setTransitionFields((current) => ({ ...current, [field.fieldId]: value }))} />)}
      </fieldset>
      <TaskArea areas={areas} value={task ? task.areaId : isSubtask ? (parentTask || tasks.find((row) => row.jiraKey === values.parent))?.areaId || null : newAreaId} inherited={isSubtask} disabled={busy} onManage={onManageAreas} onChange={(id) => { if (task) onSetArea(task, id); else setNewAreaId(id); }} />
      <TaskTags tags={tags} selected={task ? (task.tags || []).map((tag) => tag.id) : newTagIds ?? inheritedTagIds} onManage={onManageTags} shortcutsEnabled={tagShortcutsEnabled} disabled={task ? taggingId === task.id : busy} onChange={(id, assigned) => { if (task) onSetTaskTag(task, id, assigned); else if (!busy) setNewTagIds((current) => assigned ? [...new Set([...(current ?? inheritedTagIds), id])] : (current ?? inheritedTagIds).filter((item) => item !== id)); }} />
      {!task && !isSubtask && context?.issueTypes?.some((type) => type.subtask) ? <section className="subtasks-section"><h3>Subtasks</h3>{children.map((child, index) => <fieldset className="subtask-draft" key={child.requestId} disabled={busy}><div className="section-heading"><strong>Subtask {index + 1}</strong><button type="button" className="danger" onClick={() => setChildren((current) => current.filter((entry) => entry.requestId !== child.requestId))}>Remove subtask</button></div>{childFields.length ? childFields.map((field) => <JiraFieldInput key={field.fieldId} field={field} value={child.fields[field.fieldId]} autoFocus={field.fieldId === "summary"} accountId={context.accountId} disabled={busy} onChange={(value) => setChildren((current) => current.map((entry) => entry.requestId === child.requestId ? { ...entry, fields: { ...entry.fields, [field.fieldId]: value } } : entry))} />) : <p role="status">Loading subtask fields…</p>}</fieldset>)}<button type="button" disabled={fieldBusy || loading} onClick={() => setChildren((current) => [...current, { requestId: crypto.randomUUID(), fields: { ...(childContext ? defaultValues(childContext.fields, values.priority) : {}), ...(values.priority ? { priority: values.priority } : {}) } }])}>+ Add subtask</button></section> : null}
      {!task ? reminderControl : null}

    </form>
    {task && !isSubtask ? <section className="subtasks-section"><div className="section-heading"><h3>Subtasks ({subtasks.length})</h3><button type="button" disabled={fieldBusy || loading || !available} onClick={() => void leave(() => onAddSubtask?.(task))}>+ Add subtask</button></div>{activeSubtasks.map(renderSubtask)}{completedSubtasks.length ? <details className="completed-subtasks"><summary>Completed subtasks ({completedSubtasks.length})</summary>{completedSubtasks.map(renderSubtask)}</details> : null}{!subtasks.length ? <p className="muted">No subtasks yet.</p> : null}</section> : null}
    {task ? <JiraActivity task={task} tasks={tasks} onChanged={onChanged} onOpenTask={(id) => void leave(() => onOpenTask?.(id))} afterComments={reminderControl} footer={<>{dueControl}{formActions}{onDelete ? <section className="delete-task-section"><button type="button" className="danger" disabled={busy} onClick={() => void onDelete()}>Delete task</button></section> : null}</>} /> : null}
    {!task ? dueControl : null}
    {!task ? formActions : null}

  </TaskModal>;
}

export function JiraConnection({ session, busy, error, onClose, onConnect }: { session: JiraSession | null; busy: boolean; error: string; onClose: () => void; onConnect: (token: string, remember: boolean) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  return <TaskModal title="Connect Jira" busy={busy} onClose={onClose}><p>{settings.email}</p><p>Use a Jira API token to connect from any browser. No extension is required.</p><p><a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">Create a Jira API token ↗</a></p><form onSubmit={(event) => { event.preventDefault(); void onConnect(token, remember); }}>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {session?.hasCredential ? <p>A token is available from {session.credentialSource}. Leave this field blank to use it.</p> : <p>You can also prefill <code>config/credentials.json</code> before starting the app.</p>}
    <label>Jira API token<input type="password" autoComplete="off" value={token} required={!session?.hasCredential} disabled={busy} onChange={(event) => setToken(event.target.value)} /></label>
    {token ? <label className="checkbox-label"><input type="checkbox" checked={remember} disabled={busy} onChange={(event) => setRemember(event.target.checked)} /> Remember this token on this device</label> : null}
    <div className="form-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Connecting…" : "Connect Jira"}</button></div>
  </form></TaskModal>;
}
