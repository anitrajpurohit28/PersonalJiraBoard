import type { Task } from "./task-types";

export type TaskGroup = { key: string; parent: Task | null; children: Task[]; matches: Task[] };
export type BoardFilters = { view: "active" | "done" | "reminders"; source: string; priority: string; state: string; query: string };
type SearchTerm = { field: string; value: string; exclude: boolean; phrase: boolean };
const normalize = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const compact = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "");
const priorityName = (priority: number) => priority <= 2 ? "high" : priority === 3 ? "medium" : "low";
const searchable = (task: Task) => [task.title, task.jiraKey.startsWith("local:") ? "pending sync" : task.jiraKey, task.description, task.notes, task.state, task.jiraPriority, priorityName(task.priority), task.projectKey, task.issueType, task.parentKey?.startsWith("local:") ? "pending parent" : task.parentKey, task.dueDate, ...task.labels, ...task.updates.map((update) => update.body), ...(task.comments || []).flatMap((comment) => [comment.body, comment.author])].map(normalize);
export function parseTaskSearch(query: string): SearchTerm[] {
  return [...query.matchAll(/(-?)(?:([a-z]+):)?(?:"([^"]*)"|([^\s]+))/gi)].map((match) => ({ field: (match[2] || "").toLowerCase(), value: normalize(match[3] ?? match[4]), exclude: match[1] === "-", phrase: match[3] !== undefined })).filter((term) => term.value);
}
function contains(values: unknown[], term: SearchTerm) {
  return values.map(normalize).some((value) => value.includes(term.value) || (!term.phrase && compact(term.value).length > 0 && compact(value).includes(compact(term.value))));
}
function termMatches(task: Task, term: SearchTerm, today: string) {
  switch (term.field) {
    case "key": return contains([task.jiraKey.startsWith("local:") ? "pending" : task.jiraKey], term);
    case "title": return contains([task.title], term);
    case "description": return contains([task.description], term);
    case "status": return contains([task.state, task.status], term);
    case "priority": return contains([task.jiraPriority, priorityName(task.priority), task.priority], term);
    case "label": return contains(task.labels, term);
    case "comment": return contains((task.comments || []).map((comment) => comment.body), term);
    case "due": return term.value === "overdue" ? Boolean(task.dueDate && task.dueDate < today && !task.archived) : term.value === "today" ? task.dueDate === today : contains([task.dueDate], term);
    case "has": return term.value === "comments" ? Boolean(task.comments?.length) : term.value === "notes" ? Boolean(task.notes || task.updates.length) : term.value === "due" ? Boolean(task.dueDate) : false;
    case "is": return term.value === "subtask" ? Boolean(task.isSubtask || task.parentKey) : term.value === "done" ? task.archived : term.value === "pending" ? task.syncStatus !== "synced" : false;
    default: return contains(searchable(task), { ...term, value: term.field ? `${term.field}:${term.value}` : term.value });
  }
}
function localDay() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function matchesTaskSearch(tasks: Task[], query: string, today = localDay()) {
  return parseTaskSearch(query).every((term) => term.exclude ? !tasks.some((task) => termMatches(task, term, today)) : tasks.some((task) => termMatches(task, term, today)));
}
export function groupBoardTasks(tasks: Task[]): TaskGroup[] {
  const byKey = new Map(tasks.map((task) => [task.jiraKey, task]));
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    let root = task;
    const seen = new Set([root.jiraKey]);
    while (root.parentKey && byKey.has(root.parentKey) && !seen.has(root.parentKey)) { seen.add(root.parentKey); root = byKey.get(root.parentKey)!; }
    const unavailable = Boolean((root.parentKey && !byKey.has(root.parentKey)) || (root.isSubtask && !root.parentKey));
    const key = unavailable ? `parent:${root.parentKey || "unavailable"}` : root.jiraKey;
    const group = groups.get(key) || { key, parent: unavailable ? null : root, children: [], matches: [] };
    if (!group.parent || task.id !== group.parent.id) group.children.push(task);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function filterTaskGroups(groups: TaskGroup[], filters: BoardFilters): TaskGroup[] {
  return groups.flatMap((group) => {
    const members = [...(group.parent ? [group.parent] : []), ...group.children];
    // A completed child stays with its parent, until that parent is completed.
    if (filters.view !== "reminders" && group.parent && group.parent.archived !== (filters.view === "done")) return [];
    const matches = members.filter((task) => (filters.view === "reminders" ? Boolean(task.notifyAt) : group.parent || task.archived === (filters.view === "done")) && (filters.source === "all" || task.source === filters.source) && (filters.priority === "all" || (filters.priority === "high" ? task.priority <= 2 : task.priority === Number(filters.priority))) && (filters.state === "all" || task.state === filters.state));
    return matches.length && matchesTaskSearch(members, filters.query) ? [{ ...group, matches }] : [];
  });
}
