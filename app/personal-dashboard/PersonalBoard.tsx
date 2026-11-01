"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { settings, storageNamespace } from "../../config/settings.mjs";
import { orderNamedOptions, uiSettings } from "../../config/ui-settings.mjs";
import { COLUMNS, PRIORITY_OPTIONS, type Priority, type Status, type Task, type JiraSession } from "../../lib/task-types";
import { JiraConnection, JiraTaskEditor } from "./JiraTaskEditor";
import { TaskModal as Modal, localDateTime } from "./TaskModal";
import { requestJson } from "./api";
import { SyncQueuePanel } from "./SyncQueuePanel";
import { TaskGroupCard } from "./TaskGroupCard";
import { groupBoardTasks, filterTaskGroups, sortTaskGroups, orderSubtasks, selectableGroupTasks, isTaskOverdue, type BoardFilters, type TaskGroup } from "../../lib/board-tasks";
import { useDetailPosition, type DetailPosition } from "./useDetailPosition";
import { useBoardSort } from "./useBoardSort";
import { useCollapsedSubtasks } from "./useCollapsedSubtasks";
import { moveTaskBefore } from "../../lib/task-order";
import { WorkflowButtons } from "./WorkflowButtons";
import { ChoiceButtons } from "./ChoiceButtons";
import { useTaskAutosave } from "./useTaskAutosave";
import { ReminderField } from "./ReminderField";
import { TaskTags } from "./TaskTags";
import { TagManager } from "./TagManager";
import { TagFilters } from "./TagFilters";
import { ThemeToggle } from "./ThemeToggle";
import { AreaSwitcher } from "./AreaSwitcher";
import { AreaManager } from "./AreaManager";
import { TaskArea } from "./TaskArea";
import type { TaskArea as Area, AreaSyncInfo } from "../../lib/task-areas";
import type { TaskTag } from "../../lib/task-tags";
import { pendingAreaCounts, completedTaskWeeks } from "../../lib/board-summary";
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
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaSync, setAreaSync] = useState<AreaSyncInfo | undefined>();
  const [areaId, setAreaId] = useState("");
  const [showAreas, setShowAreas] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [taggingId, setTaggingId] = useState<number | null>(null);
  const tagWrites = useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<BoardFilters["view"]>("active");
  const [source, setSource] = useState<"all" | "jira" | "manual">("all");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useBoardSort();
  const [collapsedSubtasks, setSubtasksCollapsed] = useCollapsedSubtasks();
  const [expandedCompletedSubtasks, setExpandedCompletedSubtasks] = useState<Set<string>>(new Set());
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
    const [catalog, tagCatalog] = await Promise.all([requestJson("/api/areas"), requestJson("/api/tags")]);
    const next = await fetchTasks();
    setTasks(next); setAreas(catalog.areas); setAreaSync(catalog.sync); setTags(tagCatalog.tags);
    setTagIds((current) => current.filter((id) => tagCatalog.tags.some((tag: TaskTag) => tag.id === id)));
    setAreaId((current) => catalog.areas.some((area: Area) => area.id === current) ? current : "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([requestJson("/api/tags"), requestJson("/api/areas")]).then(async ([catalog, areaCatalog]) => { const next = await fetchTasks(); if (!cancelled) {
      let savedArea = "";
      try { savedArea = localStorage.getItem(`${storageNamespace}-area`) || ""; } catch { /* Private browsing can disable saved preferences. */ }
      setAreaId(areaCatalog.areas.some((area: Area) => area.id === savedArea) ? savedArea : "");
      setTasks(next); setTags(catalog.tags); setAreas(areaCatalog.areas); setAreaSync(areaCatalog.sync);
    } })
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
  const allGroups = groupBoardTasks(tasks);
  const filters = { source, priority, state: "all", query, tagIds, areaId };
  const activeGroups = filterTaskGroups(allGroups, { ...filters, view: "active" });
  const doneGroups = filterTaskGroups(allGroups, { ...filters, view: "done" });
  const groups = sortTaskGroups(view === "active" ? activeGroups : view === "done" ? doneGroups : filterTaskGroups(allGroups, { ...filters, view }), sort);
  const areaCounts = pendingAreaCounts(tasks);
  const collapseKey = (group: TaskGroup) => group.parent ? String(group.parent.id) : group.key;
  const collapsibleGroups = groups.filter((group) => group.children.some((child) => !tagIds.length || group.matches.some((match) => match.id === child.id)));
  const allSubtasksCollapsed = collapsibleGroups.length > 0 && collapsibleGroups.every((group) => collapsedSubtasks.has(collapseKey(group)));
  const visible = groups.flatMap((group) => selectableGroupTasks(group, expandedCompletedSubtasks.has(collapseKey(group)) && !collapsedSubtasks.has(collapseKey(group))));
  const countEntries = (rows: TaskGroup[]) => rows.reduce((count, group) => count + selectableGroupTasks(group, expandedCompletedSubtasks.has(collapseKey(group)) && !collapsedSubtasks.has(collapseKey(group))).length, 0);
  const activeCount = countEntries(activeGroups), doneCount = countEntries(doneGroups);
  const completedWeeks = view === "done" ? completedTaskWeeks(groups) : [];
  const checkedVisible = visible.filter((task) => checked.has(task.id));
  if (checkedVisible.length !== checked.size) setChecked(new Set(checkedVisible.map((task) => task.id)));
  const allChecked = visible.length > 0 && checkedVisible.length === visible.length;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = checkedVisible.length > 0 && !allChecked; }, [checkedVisible.length, allChecked]);
  const selected = tasks.find((task) => task.id === selectedId);
  const currentAreaName = areas.find((area) => area.id === areaId)?.name || "Unassigned";
  const areaTasks = tasks.filter((task) => (task.areaId || "") === areaId);
  const reminderCount = areaTasks.filter((task) => !task.archived && task.notifyAt).length;
  const overdueCount = areaTasks.filter((task) => isTaskOverdue(task)).length;
  function resetFilters() { setQuery(""); setPriority("all"); setSource("all"); setTagIds([]); setSort("priority"); }
  const connecting = session?.phase === "connecting";
  const available = Boolean(session?.connected || session?.availableOffline);
  const parentTask = tasks.find((task) => task.id === parentTaskId);
  type DisplayColumn = { id: string; label: string; jiraStatuses?: string[]; localStatus?: string; legacy?: boolean };
  let displayColumns: DisplayColumn[];
  if (source === "manual") displayColumns = COLUMNS.map((column) => ({ ...column, localStatus: column.id }));
  else {
    displayColumns = orderNamedOptions(session?.metadata?.columns || [], uiSettings.statusOrder).filter((column) => !column.done).map((column) => ({ id: column.id, label: column.name, jiraStatuses: column.statuses.map((status) => status.id) }));
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

  function chooseArea(id: string) {
    setAreaId(id); setQuery(""); setTagIds([]); setPriority("all"); setSource("all"); setChecked(new Set());
    try { localStorage.setItem(`${storageNamespace}-area`, id); } catch { /* Preferences are optional. */ }
  }
  async function moveTasksToArea(ids: number[], id: string | null) {
    if (await mutate(() => requestJson("/api/tasks/area", { method: "PUT", body: JSON.stringify({ ids, areaId: id }) }))) {
      setChecked(new Set());
      setMessage(`Moved to ${areas.find((area) => area.id === id)?.name || "Unassigned"}. Subtasks stay with their parent.`);
    }
  }
  async function tagsChanged() {
    const next = await requestJson("/api/tags");
    setTags(next.tags);
    setTagIds((current) => current.filter((id) => next.tags.some((tag: TaskTag) => tag.id === id)));
    await refresh();
  }
  function toggleTagFilter(id: string) {
    setTagIds((current) => current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id]);
  }
  async function setTaskTag(task: Task, id: string, assigned: boolean) {
    // Keep rapid shortcut presses in order; adding one tag never replaces another.
    tagWrites.current = tagWrites.current.then(async () => {
      setTaggingId(task.id);
      try {
        const result = await requestJson(`/api/tasks/${task.id}/tags`, { method: "PUT", body: JSON.stringify({ tagId: id, assigned }) });
        setTasks((current) => current.map((row) => row.id === task.id ? { ...row, tags: result.tags } : row));
        setError("");
      } catch (error) { setError(error instanceof Error ? error.message : "Unable to save tag."); }
      finally { setTaggingId(null); }
    });
    await tagWrites.current;
  }

  async function connect(token = "", remember = false) {
    setConnectingBusy(true);
    try { setError(""); setSession(await requestJson("/api/jira/session", { method: "POST", body: JSON.stringify({ action: "connect", apiToken: token || undefined, remember }) })); setShowConnection(false); seenRevision.current = -1; void sync(true); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to connect."); }
    finally { setConnectingBusy(false); }
  }

  function toggleCompletedSubtasks(key: string) {
    setExpandedCompletedSubtasks((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
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

  function movePayload(task: Task, status: string) {
    return task.source === "jira" ? { ...(status === "done" || status === "restore" ? { action: status } : { targetColumnId: status }), expectedUpdatedAt: task.jiraUpdatedAt } : { status: status === "restore" ? "now" : status };
  }
  async function move(task: Task, status: string) {
    await mutate(() => requestJson(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(movePayload(task, status)) }));
  }
  function inColumn(group: TaskGroup, column: DisplayColumn) {
    const task = displayTask(group);
    return column.jiraStatuses ? task.source === "jira" && column.jiraStatuses.includes(task.jiraStatusId || task.state || "pending") : task.source === "manual" && (column.legacy || task.status === column.localStatus);
  }
  function allActiveGroups() {
    // Include filtered-out cards so dragging never shuffles hidden tasks.
    return sortTaskGroups(filterTaskGroups(groupBoardTasks(tasks), { view: "active", source: "all", priority: "all", state: "all", query: "", areaId }), sort);
  }
  function saveOrder(ids: number[], parentKey: string | null = null) {
    return requestJson("/api/tasks/reorder", { method: "POST", body: JSON.stringify({ ids, parentKey }) });
  }
  async function drop(column: DisplayColumn, before?: number) {
    if (draggingId === null || busy || before === draggingId) return;
    const id = draggingId;
    setDraggingId(null);
    const task = tasks.find((task) => task.id === id);
    if (!task || task.parentKey) return;
    const ordered = allActiveGroups().filter((group) => group.parent);
    const currentGroup = ordered.find((group) => group.parent!.id === id);
    if (!currentGroup) return;
    const changingColumn = !inColumn(currentGroup, column);
    if (changingColumn && (task.source === "jira" ? !column.id.startsWith("jira-column-") : !column.localStatus)) return;
    const ids = ordered.map((group) => group.parent!.id);
    // A column-background drop appends after that column's last card.
    if (before === undefined) {
      const remaining = ordered.filter((group) => group.parent!.id !== id);
      const last = remaining.findLastIndex((group) => inColumn(group, column));
      before = last < 0 ? undefined : remaining[last + 1]?.parent?.id;
    }
    const next = moveTaskBefore(ids, id, before);
    if (await mutate(async () => {
      if (changingColumn) await requestJson(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(movePayload(task, task.source === "jira" ? column.id : column.localStatus!)) });
      await saveOrder(next);
    })) setSort("manual");
  }
  async function dropSubtask(parentKey: string, before?: number) {
    if (draggingId === null || busy || before === draggingId) return;
    const id = draggingId;
    setDraggingId(null);
    if (tasks.find((task) => task.id === id)?.parentKey !== parentKey) return;
    const ids = orderSubtasks(tasks.filter((task) => task.parentKey === parentKey)).map((task) => task.id);
    if (before !== undefined && !ids.includes(before)) return;
    if (await mutate(async () => {
      const roots = allActiveGroups().flatMap((group) => group.parent ? [group.parent.id] : []);
      if (roots.length) await saveOrder(roots);
      await saveOrder(moveTaskBefore(ids, id, before), parentKey);
    })) setSort("manual");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { setMessage("This browser does not support desktop notifications. Reminders will appear here."); return; }
    const permission = await Notification.requestPermission();
    setMessage(permission === "granted" ? "Desktop reminders enabled." : "Reminders will appear in the app.");
    localStorage.setItem(`${storageNamespace}-notifications`, permission);
  }

  const renderListGroup = (group: TaskGroup) => <TaskGroupCard key={group.key} group={group} filterSubtasks={tagIds.length > 0} onTagFilter={toggleTagFilter} completedSubtasksExpanded={expandedCompletedSubtasks.has(collapseKey(group))} onToggleCompletedSubtasks={() => toggleCompletedSubtasks(collapseKey(group))} subtasksCollapsed={collapsedSubtasks.has(collapseKey(group))} onToggleSubtasks={() => setSubtasksCollapsed([collapseKey(group)], !collapsedSubtasks.has(collapseKey(group)))} checked={checked} selectedId={selectedId} disabled={busy} onToggle={toggle} onOpen={(id) => { setError(""); setSelectedId(id); }} onMove={(task) => void move(task, task.archived ? "restore" : "done")} />;
  return (
    <main className="personal-app">
      <header className="app-header">
        <div className="board-heading">
          <div className="board-identity"><h1>PersonalJiraBoard</h1><p className="board-account">{session?.account || settings.email}</p></div>
          <AreaSwitcher areas={areas} counts={areaCounts} managed={areaSync?.managed} value={areaId} onChange={chooseArea} onManage={() => setShowAreas(true)} />
        </div>
        <div className="header-actions">
          <ThemeToggle />
          <button className="view-filter" aria-pressed={view === "reminders"} onClick={() => { resetFilters(); setView(view === "reminders" ? "active" : "reminders"); }} title="Show tasks with a reminder in this area">Reminders ({reminderCount})</button>
          <button className="view-filter" aria-pressed={view === "overdue"} onClick={() => { resetFilters(); setView(view === "overdue" ? "active" : "overdue"); }} title="Show overdue tasks in this area">Overdue ({overdueCount})</button>
          <button onClick={() => setShowTags(true)}>Tags</button>
          <button className="layout-toggle" onClick={toggleDetailPosition} aria-label={`Open task details in ${detailPosition === "right" ? "the center" : "the right side"}`} title="Remembered on this device">Details: {detailPosition === "right" ? "Right" : "Center"}</button>
          <button className={`connection header-connection ${session?.connected ? "connected" : "disconnected"}`} aria-pressed={Boolean(session?.connected)} aria-busy={syncing || connecting || connectingBusy} title={session?.connected ? "Sync is automatic. Click to work offline." : `${session?.paused ? "Sync is paused." : session?.message || "Working offline."} Click to reconnect Jira.`} disabled={session === null || syncing || connecting || connectingBusy || busy} onClick={() => {
            if (session?.connected) void requestJson("/api/jira/session", { method: "POST", body: JSON.stringify({ action: "disconnect" }) }).then(setSession).catch((error) => setError(error.message));
            else if (session?.hasCredential && session.phase !== "error") void connect();
            else { setError(""); setShowConnection(true); }
          }}><span aria-live="polite">{session?.connected ? "Jira Connected" : "Jira Offline"}</span></button>
          <button className="primary" disabled={!available || busy} title={!available ? "Connect Jira once to cache your task fields" : "Create a task, online or offline"} onClick={() => { setError(""); setParentTaskId(null); setShowNew(true); }}>+ New task</button>
          {session?.queue?.pending ? <button className={session.queue.attention ? "sync-attention" : ""} onClick={() => setShowQueue(true)}>{session.queue.pending} pending{session.queue.attention ? ` · ${session.queue.attention} need attention` : ""}</button> : null}
        </div>
      </header>

      <section className={`board-controls${tags.length ? " has-tags" : ""}`} aria-label="Board controls">
        <div className="segmented task-views" aria-label="Task view">
          <button aria-pressed={view === "active"} onClick={() => setView("active")}>Active ({activeCount})</button>
          <button aria-pressed={view === "done"} onClick={() => setView("done")}>Done ({doneCount})</button>
        </div>
        <div className="toolbar-search">
          <label className="toolbar-label" htmlFor="board-search">Search</label>
          <div className="board-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input id="board-search" ref={searchInput} type="search" className="search" placeholder="Search tasks…" aria-label="Search tasks" aria-describedby="search-help" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setQuery(""); } }} />{query ? <button type="button" aria-label="Clear search" title="Clear search (Esc)" onClick={() => { setQuery(""); searchInput.current?.focus(); }}>×</button> : null}</div>
          {tasks.some((task) => task.source === "manual") ? <div className="segmented task-sources" aria-label="Task source">
            {([['all', 'All tasks'], ['jira', 'Jira'], ['manual', 'Local']] as const).map(([id, label]) => <button key={id} aria-pressed={source === id} onClick={() => setSource(id)}>{label}</button>)}
          </div> : null}
        </div>
        {tags.length ? <TagFilters tags={tags} selected={tagIds} onToggle={toggleTagFilter} onClear={() => setTagIds([])} /> : null}
        <div className="toolbar-sort" title="Priority: High → Medium → Low, oldest first within each priority. Days: overdue and fired reminders first, then oldest first."><ChoiceButtons compact label={sort === "manual" ? "Sort · Manual" : "Sort"} value={sort} onChange={setSort} options={[{ id: "priority", name: "Priority" }, { id: "oldest", name: "Days" }]} /></div>

        <div className="toolbar-priority"><ChoiceButtons compact label="Priority" order={["All", ...uiSettings.priorityOrder]} value={priority} onChange={setPriority} options={[{ id: "all", name: "All" }, { id: "high", name: "High" }, { id: "3", name: "Medium" }, { id: "4", name: "Low" }]} /></div>
      </section>

      {view === "reminders" || view === "overdue" ? <div className="notice filtered-view"><span>{view === "overdue" ? `Unfinished overdue tasks in ${currentAreaName}` : `Tasks with reminders in ${currentAreaName}`} · using the selected sort. Parent tasks and subtasks stay together.</span>{view === "reminders" ? <button onClick={() => void enableNotifications()}>Enable desktop notifications</button> : null}<button onClick={() => setView("active")}>Back to Active</button></div> : null}
      {!available && session?.message ? <p className="notice" role="status">{session.message}</p> : null}
      {error ? <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div> : null}
      {message ? <div className="notice" role="status"><span>{message}</span><button onClick={() => setMessage("")}>Dismiss</button></div> : null}

      <section className="bulk-bar" aria-label="Bulk task actions" aria-busy={busy}>
        <label><input ref={selectAll} type="checkbox" checked={allChecked} disabled={busy || loading || !visible.length} title="Select matching tasks; hidden completed subtasks are excluded" onChange={() => setChecked(allChecked ? new Set() : new Set(visible.map((task) => task.id)))} /> Select all ({visible.length})</label>
        <span className="task-count" role="status">{loading ? "Loading…" : `${groups.length} task ${groups.length === 1 ? "group" : "groups"}`}{query ? ` · ${visible.length} matches` : ""}</span>
        {collapsibleGroups.length ? <button className="subtasks-toggle-all" type="button" onClick={() => setSubtasksCollapsed(collapsibleGroups.map(collapseKey), !allSubtasksCollapsed)}>{allSubtasksCollapsed ? "Expand all subtasks" : "Collapse all subtasks"}</button> : null}
        {checked.size ? <div className="bulk-actions"><span className="selection-count" role="status">{checkedVisible.length} selected</span><button disabled={busy} onClick={() => setChecked(new Set())}>Clear</button><label className="bulk-area-move"><span className="sr-only">Move selected tasks to area</span><select aria-label="Move selected tasks to area" value="" disabled={busy} title="Moves selected tasks, their parent tasks and all subtasks" onChange={(event) => { if (event.target.value) void moveTasksToArea(checkedVisible.map((task) => task.id), event.target.value === "unassigned" ? null : event.target.value); }}><option value="" disabled>Move to area…</option><option value="unassigned">Unassigned</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>{view === "active" ? <button disabled={busy} onClick={() => void bulk("done")}>Mark selected done</button> : null}<button className="danger" disabled={busy} onClick={() => void bulk("delete")}>Delete selected</button></div> : null}
        <details className="search-help"><summary>Search help</summary><p id="search-help">Search by title, key, description, labels, notes, cached comments, or subtasks. Combine words, use &quot;exact phrases&quot; or -exclude. Filters: key:KAN2, tag:work, priority:high, status:&quot;In Progress&quot;, label:home, comment:&quot;follow up&quot;, due:overdue, has:comments, is:subtask. Cmd/Ctrl+F or / focuses search; Esc clears it.</p></details>
      </section>

      {!loading && !groups.length ? <p className="empty-state" role="status">{query || priority !== "all" || tagIds.length ? "No tasks match your search or filters. Try clearing them or switching Active / Done." : view === "overdue" ? "No overdue tasks." : view === "reminders" ? "No tasks have reminders set. Add a reminder in task details." : view === "done" ? "No completed tasks." : `No active tasks in ${currentAreaName}.`}</p> : null}
      {loading ? <p className="empty-state" role="status">Loading tasks…</p> : view === "active" ? <section className="task-board" aria-label="Active tasks">{displayColumns.map((column) => {
        const rows = groups.filter((group) => inColumn(group, column));
        return <section className="task-column" key={column.id} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); void drop(column); }}>
          <h2>{column.label}<span>{rows.length}</span></h2>
          {rows.map((group) => <TaskGroupCard key={group.key} group={group} filterSubtasks={tagIds.length > 0} onTagFilter={toggleTagFilter} completedSubtasksExpanded={expandedCompletedSubtasks.has(collapseKey(group))} onToggleCompletedSubtasks={() => toggleCompletedSubtasks(collapseKey(group))} subtasksCollapsed={collapsedSubtasks.has(collapseKey(group))} onToggleSubtasks={() => setSubtasksCollapsed([collapseKey(group)], !collapsedSubtasks.has(collapseKey(group)))} checked={checked} selectedId={selectedId} disabled={busy} onToggle={toggle} onOpen={(id) => { setError(""); setSelectedId(id); }} onMove={(task) => void move(task, task.archived ? "restore" : "done")} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} onSubtaskDrop={(before) => { if (!group.parent || tasks.find((task) => task.id === draggingId)?.parentKey !== group.parent.jiraKey) return false; void dropSubtask(group.parent.jiraKey, before); return true; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void drop(column, group.parent?.id); }} />)}
          {!rows.length ? <p className="column-empty">No tasks</p> : null}
        </section>;
      })}</section> : view === "done" ? <section className="done-weeks" aria-label="Completed tasks">{completedWeeks.map((week) => <section className="done-week" key={week.key} aria-labelledby={`done-week-${week.key}`}><h2 id={`done-week-${week.key}`}>{week.label}<span>{countEntries(week.groups)}</span></h2><div className="done-list">{week.groups.map(renderListGroup)}</div></section>)}</section> : <section className="done-list" aria-label={view === "overdue" ? "Overdue tasks" : "Tasks with reminders"}>{groups.map(renderListGroup)}</section>}

      {showAreas ? <AreaManager areas={areas} sync={areaSync} onChanged={refresh} onClose={() => setShowAreas(false)} /> : null}
      {showTags ? <TagManager tags={tags} onChanged={tagsChanged} onClose={() => setShowTags(false)} /> : null}
      {showConnection ? <JiraConnection session={session} busy={connectingBusy} error={error} onClose={() => setShowConnection(false)} onConnect={connect} /> : null}
      {showQueue ? <SyncQueuePanel onClose={() => setShowQueue(false)} onChanged={async () => { await sync(); }} /> : null}
      {showNew ? <JiraTaskEditor areas={areas} defaultAreaId={areaId || null} onManageAreas={() => setShowAreas(true)} onSetArea={(task, id) => void moveTasksToArea([task.id], id)} tags={tags} onManageTags={() => setShowTags(true)} tagShortcutsEnabled={!showTags && !showAreas} taggingId={taggingId} onSetTaskTag={(task, id, assigned) => void setTaskTag(task, id, assigned)} position={detailPosition} onTogglePosition={toggleDetailPosition} key={parentTaskId ? `create-subtask:${parentTaskId}` : "create-task"} parentTask={parentTask} tasks={tasks} session={session} busy={busy} available={available} connected={Boolean(session?.connected)} serverError={error} onClose={() => { setShowNew(false); if (parentTaskId) setSelectedId(parentTaskId); setParentTaskId(null); }} onChanged={refresh} onSave={(payload) => mutate(async () => { const result = await requestJson("/api/tasks", { method: "POST", body: JSON.stringify(payload) }); setMessage(result.warning || (result.pending ? "Task saved on this device and queued for Jira sync." : `Created ${result.jiraKey} in Jira.`)); return result; })} /> : null}
      {selected?.source === "jira" ? <JiraTaskEditor areas={areas} defaultAreaId={areaId || null} onManageAreas={() => setShowAreas(true)} onSetArea={(task, id) => void moveTasksToArea([task.id], id)} tags={tags} onManageTags={() => setShowTags(true)} tagShortcutsEnabled={!showTags && !showAreas} taggingId={taggingId} onSetTaskTag={(task, id, assigned) => void setTaskTag(task, id, assigned)} position={detailPosition} onTogglePosition={toggleDetailPosition} key={`edit:${selected.id}`} task={selected} tasks={tasks} session={session} busy={busy} available={available} connected={Boolean(session?.connected)} serverError={error} onClose={() => setSelectedId(null)} onChanged={refresh} onAddSubtask={(parent) => { setSelectedId(null); setParentTaskId(parent.id); setShowNew(true); }} onOpenTask={setSelectedId} onRenameSubtask={(child, title, baseSummary) => mutate(() => requestJson(`/api/tasks/${child.id}`, { method: "PATCH", body: JSON.stringify({ fields: { summary: title }, baseFields: { summary: baseSummary }, expectedUpdatedAt: child.jiraUpdatedAt }) }))} onSave={(payload) => mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "PATCH", body: JSON.stringify(payload) }))} onDelete={async () => { if (window.confirm(`Delete “${selected.title}” from Jira and remove its private notes when sync completes? This cannot be undone after Jira confirms deletion. Unselected subtasks will be kept.`) && await mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "DELETE", body: JSON.stringify({ confirmDelete: true }) }))) setSelectedId(null); }} /> : selected ? <TaskEditor areas={areas} onManageAreas={() => setShowAreas(true)} onSetArea={(id) => void moveTasksToArea([selected.id], id)} tags={tags} onManageTags={() => setShowTags(true)} tagShortcutsEnabled={!showTags && !showAreas} tagging={taggingId === selected.id} onSetTag={(id, assigned) => void setTaskTag(selected, id, assigned)} position={detailPosition} onTogglePosition={toggleDetailPosition} key={`edit:${selected.id}`} task={selected} title="Local task details" busy={busy} onClose={() => setSelectedId(null)} onSave={(changes) => mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "PATCH", body: JSON.stringify(changes) }))} onDelete={async () => { if (window.confirm(`Delete “${selected.title}” and its notes? This cannot be undone.`) && await mutate(() => requestJson(`/api/tasks/${selected.id}`, { method: "DELETE" }))) setSelectedId(null); }} /> : null}
    </main>
  );
}

function TaskEditor({ task, title, busy, onClose, onSave, onDelete, position, onTogglePosition, tags, onManageTags, tagShortcutsEnabled, tagging, onSetTag, areas, onManageAreas, onSetArea }: {
  areas: Area[]; onManageAreas: () => void; onSetArea: (id: string | null) => void;
  tags: TaskTag[]; onManageTags: () => void; tagShortcutsEnabled: boolean; tagging: boolean; onSetTag: (id: string, assigned: boolean) => void;
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
      <WorkflowButtons options={[...COLUMNS.map((column) => ({ id: column.id, name: column.label })), { id: "done", name: "Done" }]} value={status} disabled={busy} onChange={(value) => { setStatus(value as Status); if (value === "done") setNotifyAt(""); }} />
      <ChoiceButtons label="Priority" order={uiSettings.priorityOrder} value={String(priority === 1 ? 2 : priority)} disabled={busy} onChange={(value) => setPriority(Number(value) as Priority)} options={PRIORITY_OPTIONS} />
      <ReminderField value={status === "done" ? "" : notifyAt} onChange={setNotifyAt} fired={Boolean(task.notifyFired && task.notifyAt && localDateTime(task.notifyAt) === notifyAt)} disabled={busy || status === "done"} />
    </fieldset><TaskArea areas={areas} value={task.areaId} disabled={busy} onChange={onSetArea} onManage={onManageAreas} /><TaskTags tags={tags} selected={(task.tags || []).map((tag) => tag.id)} onManage={onManageTags} shortcutsEnabled={tagShortcutsEnabled} disabled={tagging} onChange={onSetTag} /></form>
    <div className="form-actions"><span className={`save-status save-${autosave.state}`} role="status">{autosave.state === "saving" ? "Saving…" : autosave.state === "error" ? "Not saved · check required fields" : autosave.state === "unsaved" ? "Unsaved changes" : "Changes saved automatically"}</span><button className="primary" type="submit" form={`local-task-${task.id}`} disabled={closing}>{autosave.state === "error" ? "Retry save" : "Done"}</button></div>
    {onDelete ? <section className="delete-task-section"><button className="danger" type="button" disabled={busy} onClick={() => void onDelete()}>Delete task</button></section> : null}
  </Modal>;
}
