"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { settings, storageNamespace } from "../../config/settings.mjs";
import { COLUMNS, PRIORITY_OPTIONS, type Priority, type Status, type Task, type JiraSession } from "../../lib/task-types";
import { JiraConnection, JiraTaskEditor } from "./JiraTaskEditor";
import { TaskModal as Modal, localDateTime } from "./TaskModal";
import { requestJson } from "./api";
import { SyncQueuePanel } from "./SyncQueuePanel";
import { TaskGroupCard } from "./TaskGroupCard";
import { groupBoardTasks, filterTaskGroups, type TaskGroup } from "../../lib/board-tasks";
import { useDetailPosition, type DetailPosition } from "./useDetailPosition";
import { WorkflowButtons } from "./WorkflowButtons";
import { ChoiceButtons } from "./ChoiceButtons";
import { useTaskAutosave } from "./useTaskAutosave";
import { ReminderField } from "./ReminderField";
import { reminderKey, remindersToFire } from "../../lib/task-reminders";

type Changes = { title: string; priority: Priority; status: Status; notifyAt: string | null };

async function fetchTasks(): Promise<Task[]> {
  const [active, done] = await Promise.all([requestJson("/api/tasks?view=active"), requestJson("/api/tasks?view=done")]);
  return [...active.tasks, ...done.tasks];
}

export default function PersonalBoard() {
  const [detailPosition, toggleDetailPosition] = useDetailPosition();
  const searchInput = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<"active" | "done" | "reminders">("active");
  const [source, setSource] = useState<"all" | "jira" | "manual">("all");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState("priority");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [parentTaskId, setParentTaskId] = useState<number | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const seenRevision = useRef(-1);
  const [session, setSession] = useState<JiraSession | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [connectingBusy, setConnectingBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const syncInFlight = useRef(false);
  const remindersInFlight = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setTasks(await fetchTasks());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchTasks().then((next) => { if (!cancelled) setTasks(next); })
      .catch((error) => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const sync = useCallback(async (force = false) => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      const result = await requestJson("/api/jira/sync", { method: "POST", body: JSON.stringify({ refresh: force }) });
      await refresh();
      seenRevision.current = result.queue?.revision ?? seenRevision.current;
      if (force) setMessage(result.connected ? "Syncing your saved changes with Jira…" : "Changes are saved on this device. Sync will resume when Jira is available.");
    } catch {
      setSession((current) => current ? { ...current, connected: false, phase: "unavailable", message: "Jira is not connected. Changes are saved on this device." } : current);
    }
    finally { syncInFlight.current = false; setSyncing(false); }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const next = await requestJson("/api/jira/session");
        if (cancelled) return;
        setSession(next.availableOffline && !navigator.onLine ? { ...next, connected: false, phase: "offline" } : next);
        if (next.availableOffline && next.queue?.revision !== seenRevision.current) void sync();
      } catch {
        if (!cancelled) setSession((current) => ({ ...current, connected: false, phase: "unavailable", message: "Jira is not connected. Local tasks are available." }));
      }
    }
    void check();
    const timer = window.setInterval(check, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sync]);

  useEffect(() => {
    const online = () => { if (session?.availableOffline && !session.paused) void sync(true); };
    const offline = () => setSession((current) => current ? { ...current, connected: false, phase: "offline", message: "Jira is not connected. Changes are saved on this device." } : current);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [session?.availableOffline, session?.paused, sync]);

  useEffect(() => {
    async function fireReminders() {
      for (const task of remindersToFire(tasks)) {
        const key = reminderKey(task);
        if (remindersInFlight.current.has(key)) continue;
        remindersInFlight.current.add(key);
        try {
          const result = await requestJson(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ notifyFired: true, expectedNotifyAt: task.notifyAt }) });
          if (result.fired) {
            setMessage(`Reminder: ${task.title}`);
            if ("Notification" in window && Notification.permission === "granted") new Notification("Task reminder", { body: task.title });
          }
          await refresh();
        } catch { /* Retry locally on the next check; the saved reminder is untouched. */ }
        finally { remindersInFlight.current.delete(key); }
      }
    }
    void fireReminders();
    const timer = window.setInterval(fireReminders, 5000);
    return () => window.clearInterval(timer);
  }, [tasks, refresh]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const typing = event.target instanceof HTMLElement && Boolean(event.target.closest("input,textarea,select,[contenteditable=true]"));
      if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") || (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey)) {
        event.preventDefault(); searchInput.current?.focus(); searchInput.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch); return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const displayTask = (group: TaskGroup) => group.parent || group.matches[0];
  const groups = filterTaskGroups(groupBoardTasks(tasks), { view, source, priority, state: "all", query }).sort((a, b) => {
    const left = displayTask(a), right = displayTask(b);
    if (view === "reminders") return Math.min(...a.matches.map((task) => Date.parse(task.notifyAt!))) - Math.min(...b.matches.map((task) => Date.parse(task.notifyAt!)));
    if (sort === "oldest") return left.createdAt.localeCompare(right.createdAt);
    return left.priority - right.priority || right.id - left.id;
  });
  const visible = groups.flatMap((group) => group.matches);
  const checkedVisible = visible.filter((task) => checked.has(task.id));
  if (checkedVisible.length !== checked.size) setChecked(new Set(checkedVisible.map((task) => task.id)));
  const allChecked = visible.length > 0 && checkedVisible.length === visible.length;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = checkedVisible.length > 0 && !allChecked; }, [checkedVisible.length, allChecked]);
  const selected = tasks.find((task) => task.id === selectedId);
  const reminderCount = tasks.filter((task) => task.notifyAt).length;
  function resetFilters() { setQuery(""); setPriority("all"); setSource("all"); setSort("priority"); }
  const connecting = session?.phase === "connecting";
  const available = Boolean(session?.connected || session?.availableOffline);
  const parentTask = tasks.find((task) => task.id === parentTaskId);
  type DisplayColumn = { id: string; label: string; jiraStatuses?: string[]; localStatus?: string; legacy?: boolean };
  let displayColumns: DisplayColumn[];
  if (source === "manual") displayColumns = COLUMNS.map((column) => ({ ...column, localStatus: column.id }));
  else {
    displayColumns = (session?.metadata?.columns || []).filter((column) => !column.done).map((column) => ({ id: column.id, label: column.name, jiraStatuses: column.statuses.map((status) => status.id) }));
    const mapped = new Set(displayColumns.flatMap((column) => column.jiraStatuses || []));
    for (const task of groups.map(displayTask).filter((task) => task.source === "jira")) {
      const state = task.jiraStatusId || task.state || "pending";
      if (!mapped.has(state)) { mapped.add(state); displayColumns.push({ id: `unmapped-${state}`, label: task.state || "Sync pending", jiraStatuses: [state] }); }
    }
    if (visible.some((task) => task.source === "manual")) displayColumns.push({ id: "legacy", label: "Local tasks", legacy: true });
  }

  async function mutate(work: () => Promise<unknown>) {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setBusy(true); setMessage("");
    try { const result = await work() as { warning?: string } | undefined; await refresh(); setError(""); if (result?.warning) setMessage(result.warning); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to save."); return false; }
    finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function connect(token = "", remember = false) {
    setConnectingBusy(true);
    try { setError(""); setSession(await requestJson("/api/jira/session", { method: "POST", body: JSON.stringify({ action: "connect", apiToken: token || undefined, remember }) })); setShowConnection(false); seenRevision.current = -1; void sync(true); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to connect."); }
    finally { setConnectingBusy(false); }
  }

  function toggle(id: number) {
    setChecked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulk(action: "done" | "delete") {
    const ids = checkedVisible.map((task) => task.id);
    if (!ids.length || busy) return;
    const jiraCount = checkedVisible.filter((task) => task.source === "jira").length;
    if (action === "delete" && !window.confirm(`Permanently delete ${ids.length} selected ${ids.length === 1 ? "task" : "tasks"}${jiraCount ? `, including ${jiraCount} Jira ${jiraCount === 1 ? "issue" : "issues"} from Jira` : ""}, and their private notes? This cannot be undone. Unselected subtasks will not be deleted.`)) return;
    setBusy(true);
    try {
      const result = await requestJson("/api/tasks/bulk", { method: "POST", body: JSON.stringify({ action, ids, confirmDelete: action === "delete" }) });
      const succeeded = new Set<number>(result.succeededIds);
      setChecked(new Set(ids.filter((id) => !succeeded.has(id))));
      if (selectedId !== null && succeeded.has(selectedId)) setSelectedId(null);
      await refresh();
      setMessage(`${succeeded.size} ${succeeded.size === 1 ? "task" : "tasks"} ${action === "done" ? "marked done" : "removed"}${result.pending ? "; changes saved for sync" : ""}.`);
      setError(result.failed.length ? result.failed.map((item: { key: string; error: string }) => `${item.key}: ${item.error}`).join(" ") : "");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to update Jira."); }
    finally { setBusy(false); }
  }

  async function move(task: Task, status: string) {
    const payload = task.source === "jira" ? { ...(status === "done" || status === "restore" ? { action: status } : { targetColumnId: status }), expectedUpdatedAt: task.jiraUpdatedAt } : { status: status === "restore" ? "now" : status };
    await mutate(() => requestJson(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(payload) }));
  }

  async function drop(column: DisplayColumn, before?: number) {
    if (draggingId === null || busy) return;
    const id = draggingId;
    setDraggingId(null);
    const task = tasks.find((task) => task.id === id);
    if (!task) return;
    if (task.source === "jira") { if (column.id.startsWith("jira-column-")) await move(task, column.id); return; }
    if (!column.localStatus) return;
    const status = column.localStatus as Exclude<Status, "done">;
    const columns = Object.fromEntries(COLUMNS.map((column) => [column.id, tasks.filter((task) => task.source === "manual" && !task.archived && task.status === column.id && task.id !== id).map((task) => task.id)])) as Record<Exclude<Status, "done">, number[]>;
    const index = before === undefined ? -1 : columns[status].indexOf(before);
    if (index < 0) columns[status].push(id); else columns[status].splice(index, 0, id);
    if (await mutate(() => requestJson("/api/tasks/reorder", { method: "POST", body: JSON.stringify({ columns }) }))) setSort("priority");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { setMessage("This browser does not support desktop notifications. Reminders will appear here."); return; }
    const permission = await Notification.requestPermission();
    setMessage(permission === "granted" ? "Desktop reminders enabled." : "Reminders will appear in the app.");
    localStorage.setItem(`${storageNamespace}-notifications`, permission);
  }

  return (
    <main className="personal-app">
      <header className="app-header">
        <div><h1>My tasks</h1><p>{session?.metadata?.boardName ? `${session.metadata.boardName} · ` : ""}{settings.email}</p></div>
        <div className="header-actions">
          <button aria-pressed={view === "reminders"} onClick={() => { resetFilters(); setView(view === "reminders" ? "active" : "reminders"); }} title="Show every task with a reminder">Reminders ({reminderCount})</button>
          <button className="layout-toggle" onClick={toggleDetailPosition} aria-label={`Open task details in ${detailPosition === "right" ? "the center" : "the right side"}`} title="Remembered on this device">Details: {detailPosition === "right" ? "Right" : "Center"}</button>
          {session?.queue?.pending ? <button className={session.queue.attention ? "sync-attention" : ""} onClick={() => setShowQueue(true)}>{session.queue.pending} pending{session.queue.attention ? ` · ${session.queue.attention} need attention` : ""}</button> : null}
          <button className="primary" disabled={!available || busy} title={!available ? "Connect Jira once to cache your task fields" : "Create a task, online or offline"} onClick={() => { setError(""); setParentTaskId(null); setShowNew(true); }}>+ New task</button>
        </div>
      </header>

      <section className="board-controls" aria-label="Board controls">
        <div className="segmented task-views" aria-label="Task view">
          <button aria-pressed={view === "active"} onClick={() => setView("active")}>Active</button>
          <button aria-pressed={view === "done"} onClick={() => setView("done")}>Done</button>
        </div>
        <div className="toolbar-search">
          <label className="toolbar-label" htmlFor="board-search">Search</label>
          <div className="board-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input id="board-search" ref={searchInput} type="search" className="search" placeholder="Search tasks, comments, subtasks…" aria-label="Search tasks" aria-describedby="search-help" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setQuery(""); } }} />{query ? <button type="button" aria-label="Clear search" title="Clear search (Esc)" onClick={() => { setQuery(""); searchInput.current?.focus(); }}>×</button> : null}</div>
          {tasks.some((task) => task.source === "manual") ? <div className="segmented task-sources" aria-label="Task source">
            {([['all', 'All tasks'], ['jira', 'Jira'], ['manual', 'Local']] as const).map(([id, label]) => <button key={id} aria-pressed={source === id} onClick={() => setSource(id)}>{label}</button>)}
          </div> : null}
        </div>
        <div className="toolbar-sort"><ChoiceButtons compact label="Sort" value={sort} onChange={setSort} options={[{ id: "priority", name: "Priority" }, { id: "oldest", name: "Days" }]} /></div>
        <div className="toolbar-connection">
          <span className="toolbar-label">Jira sync</span>
          <button className={`connection ${session?.connected ? "connected" : "disconnected"}`} aria-pressed={Boolean(session?.connected)} aria-busy={syncing || connecting || connectingBusy} title={session?.connected ? "Sync is automatic. Click to work offline." : `${session?.paused ? "Sync is paused." : session?.message || "Working offline."} Click to reconnect Jira.`} disabled={session === null || syncing || connecting || connectingBusy || busy} onClick={() => {
            if (session?.connected) void requestJson("/api/jira/session", { method: "POST", body: JSON.stringify({ action: "disconnect" }) }).then(setSession).catch((error) => setError(error.message));
            else if (session?.hasCredential && session.phase !== "error") void connect();
            else { setError(""); setShowConnection(true); }
          }}><span aria-live="polite">{connecting || connectingBusy ? "Connecting…" : session === null ? "Checking…" : session.connected ? "Jira connected" : "Offline"}</span></button>
        </div>
        <div className="toolbar-priority"><ChoiceButtons compact label="Priority" value={priority} onChange={setPriority} options={[{ id: "all", name: "All" }, { id: "high", name: "High" }, { id: "3", name: "Medium" }, { id: "4", name: "Low" }]} /></div>
      </section>

      {view === "reminders" ? <div className="notice reminder-view"><span>Tasks with reminders · soonest first. Parent tasks and subtasks stay together.</span><button onClick={() => void enableNotifications()}>Enable desktop notifications</button><button onClick={() => setView("active")}>Back to Active</button></div> : null}
      {!available && session?.message ? <p className="notice" role="status">{session.message}</p> : null}
      {error ? <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div> : null}
      {message ? <div className="notice" role="status"><span>{message}</span><button onClick={() => setMessage("")}>Dismiss</button></div> : null}

      <section className="bulk-bar" aria-label="Bulk task actions" aria-busy={busy}>
        <label><input ref={selectAll} type="checkbox" checked={allChecked} disabled={busy || loading || !visible.length} onChange={() => setChecked(allChecked ? new Set() : new Set(visible.map((task) => task.id)))} /> Select all visible ({visible.length})</label>
        <span className="task-count" role="status">{loading ? "Loading…" : `${groups.length} task ${groups.length === 1 ? "group" : "groups"}`}{query ? ` · ${visible.length} matches` : ""}</span>
        {checked.size ? <div className="bulk-actions"><span className="selection-count" role="status">{checkedVisible.length} selected</span><button disabled={busy} onClick={() => setChecked(new Set())}>Clear</button>{view === "active" ? <button disabled={busy} onClick={() => void bulk("done")}>Mark selected done</button> : null}<button className="danger" disabled={busy} onClick={() => void bulk("delete")}>Delete selected</button></div> : null}
        <details className="search-help"><summary>Search help</summary><p id="search-help">Search by title, key, description, labels, notes, cached comments, or subtasks. Combine words, use &quot;exact phrases&quot; or -exclude. Filters: key:KAN2, priority:high, status:&quot;In Progress&quot;, label:home, comment:&quot;follow up&quot;, due:overdue, has:comments, is:subtask. Cmd/Ctrl+F or / focuses search; Esc clears it.</p></details>
      </section>

      {!loading && !groups.length ? <p className="empty-state" role="status">{query || priority !== "all" ? "No tasks match your search or filters. Try clearing them or switching Active / Done." : view === "reminders" ? "No tasks have reminders set. Add a reminder in task details." : view === "done" ? "No completed tasks." : "No active tasks."}</p> : null}
      {loading ? <p className="empty-state" role="status">Loading tasks…</p> : view === "active" ? <section className="task-board" aria-label="Active tasks">{displayColumns.map((column) => {
        const rows = groups.filter((group) => { const task = displayTask(group); return column.jiraStatuses ? task.source === "jira" && column.jiraStatuses.includes(task.jiraStatusId || task.state || "pending") : task.source === "manual" && (column.legacy || task.status === column.localStatus); });
        return <section className="task-column" key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void drop(column); }}>
          <h2>{column.label}<span>{rows.length}</span></h2>
          {rows.map((group) => <TaskGroupCard key={group.key} group={group} checked={checked} selectedId={selectedId} disabled={busy} onToggle={toggle} onOpen={(id) => { setError(""); setSelectedId(id); }} onMove={(task) => void move(task, task.archived ? "restore" : "done")} onDragStart={() => setDraggingId(group.parent?.id ?? null)} onDragEnd={() => setDraggingId(null)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void drop(column, group.parent?.id); }} />)}
          {!rows.length ? <p className="column-empty">No tasks</p> : null}
        </section>;
      })}</section> : <section className="done-list" aria-label={view === "reminders" ? "Tasks with reminders" : "Completed tasks"}>{groups.map((group) => <TaskGroupCard key={group.key} group={group} checked={checked} selectedId={selectedId} disabled={busy} onToggle={toggle} onOpen={(id) => { setError(""); setSelectedId(id); }} onMove={(task) => void move(task, task.archived ? "restore" : "done")} />)}</section>}

      {showConnection ? <JiraConnection session={session} busy={connectingBusy} error={error} onClose={() => setShowConnection(false)} onConnect={connect} /> : null}
      {showQueue ? <SyncQueuePanel onClose={() => setShowQueue(false)} onChanged={async () => { await sync(); }} /> : null}
      {showNew ? <JiraTaskEditor position={detailPosition} onTogglePosition={toggleDetailPosition} key={parentTaskId ? `create-subtask:${parentTaskId}` : "create-task"} parentTask={parentTask} tasks={tasks} busy={busy} available={available} connected={Boolean(session?.connected)} serverError={error} onClose={() => { setShowNew(false); if (parentTaskId) setSelectedId(parentTaskId); setParentTaskId(null); }} onChanged={refresh} onSave={(payload) => mutate(async () => { const result = await requestJson("/api/tasks", { method: "POST", body: JSON.stringify(payload) }); setMessage(result.warning || (result.pending ? "Task saved on this device and queued for Jira sync." : `Created ${result.jiraKey} in Jira.`)); return result; })} /> : null}
      {selected?.source === "jira" ? <JiraTaskEditor position={detailPosition} onTogglePosition={toggleDetailPosition} key={`edit:${selected.id}`} task={selected} tasks={tasks} busy={busy} available={available} connected={Boolean(session?.connected)} serverError={error} onClose={() => setSelectedId(null)} onChanged={refresh} onAddSubtask={(parent) => { setSelectedId(null); setParentTaskId(parent.id); setShowNew(true); }} onOpenTask={setSelectedId} onRenameSubtask={(child, title, baseSummary) => mutate(() => requestJson(`/api/tasks/${child.id}`, { method: "PATCH", body: JSON.stringify({ fields: { summary: title }, baseFields: { summary: baseSummary }, expectedUpdatedAt: child.jiraUpdatedAt }) }))} onSave={(payload) => mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "PATCH", body: JSON.stringify(payload) }))} onDelete={async () => { if (window.confirm(`Delete “${selected.title}” from Jira and remove its private notes when sync completes? This cannot be undone after Jira confirms deletion. Unselected subtasks will be kept.`) && await mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "DELETE", body: JSON.stringify({ confirmDelete: true }) }))) setSelectedId(null); }} /> : selected ? <TaskEditor position={detailPosition} onTogglePosition={toggleDetailPosition} key={`edit:${selected.id}`} task={selected} title="Local task details" busy={busy} onClose={() => setSelectedId(null)} onSave={(changes) => mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "PATCH", body: JSON.stringify(changes) }))} onDelete={async () => { if (window.confirm(`Delete “${selected.title}” and its notes? This cannot be undone.`) && await mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "DELETE" }))) setSelectedId(null); }} /> : null}
    </main>
  );
}

function TaskEditor({ task, title, busy, onClose, onSave, onDelete, position, onTogglePosition }: {
  task: Task; position: DetailPosition; onTogglePosition: () => void; title: string; busy: boolean; onClose: () => void; onSave: (changes: Changes) => Promise<boolean>; onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(task.title);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [status, setStatus] = useState<Status>(task.status);
  const [notifyAt, setNotifyAt] = useState(localDateTime(task.notifyAt));
  const form = useRef<HTMLFormElement>(null);
  const [closing, setClosing] = useState(false);
  const [initialReminder] = useState(() => ({ local: localDateTime(task.notifyAt), raw: task.notifyAt }));
  const changes: Changes = { title: name.trim(), priority, status, notifyAt: notifyAt === initialReminder.local ? initialReminder.raw : notifyAt ? new Date(notifyAt).toISOString() : null };
  const initial = useRef(JSON.stringify(changes));
  const autosave = useTaskAutosave(JSON.stringify(changes), true, () => JSON.stringify(changes) === initial.current ? null : changes, async (snapshot) => {
    if (!form.current?.checkValidity() || !snapshot.title || !await onSave(snapshot)) return false;
    initial.current = JSON.stringify(snapshot); return true;
  });
  async function leave() { if (closing) return; setClosing(true); try { if (await autosave.flush()) onClose(); else form.current?.reportValidity(); } finally { setClosing(false); } }
  function submit(event: FormEvent) { event.preventDefault(); void leave(); }
  return <Modal position={position} onTogglePosition={onTogglePosition} title={title} onClose={() => void leave()} busy={closing || (busy && autosave.state !== "saving")}>
    <form ref={form} id={`local-task-${task.id}`} onSubmit={submit}><fieldset disabled={busy}>
      <label>Title<input autoFocus required maxLength={300} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <WorkflowButtons options={[...COLUMNS.map((column) => ({ id: column.id, name: column.label })), { id: "done", name: "Done" }]} value={status} disabled={busy} onChange={(value) => setStatus(value as Status)} />
      <ChoiceButtons label="Priority" value={String(priority === 1 ? 2 : priority)} disabled={busy} onChange={(value) => setPriority(Number(value) as Priority)} options={PRIORITY_OPTIONS} />
      <ReminderField value={notifyAt} onChange={setNotifyAt} fired={Boolean(task.notifyFired && task.notifyAt && localDateTime(task.notifyAt) === notifyAt)} disabled={busy} />
    </fieldset></form>
    <div className="form-actions"><span className={`save-status save-${autosave.state}`} role="status">{autosave.state === "saving" ? "Saving…" : autosave.state === "error" ? "Not saved · check required fields" : autosave.state === "unsaved" ? "Unsaved changes" : "Changes saved automatically"}</span><button className="primary" type="submit" form={`local-task-${task.id}`} disabled={closing}>{autosave.state === "error" ? "Retry save" : "Done"}</button></div>
    {onDelete ? <section className="delete-task-section"><button className="danger" type="button" disabled={busy} onClick={() => void onDelete()}>Delete task</button></section> : null}
  </Modal>;
}
