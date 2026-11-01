import type { Task } from "./task-types";
import type { TaskGroup } from "./board-tasks";

export function pendingAreaCounts(tasks: readonly Pick<Task, "areaId" | "archived">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) if (!task.archived) {
    const id = task.areaId || ""; counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

export type CompletedWeek = { key: string; label: string; groups: TaskGroup[] };
function completionWeek(value: string | null | undefined): { key: string; label: string } {
  const raw = value && (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  const date = raw ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) return { key: "unknown", label: "Completion date unavailable" };
  // Calendar arithmetic keeps Monday correct across timezones and DST changes.
  date.setDate(date.getDate() - (date.getDay() + 6) % 7); date.setHours(0, 0, 0, 0);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { key, label: `Week of ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date)}` };
}

export function completedTaskWeeks(groups: readonly TaskGroup[]): CompletedWeek[] {
  const weeks = new Map<string, CompletedWeek>();
  const add = (value: string | null, group: TaskGroup) => {
    const period = completionWeek(value), week = weeks.get(period.key) || { ...period, groups: [] };
    week.groups.push(group); weeks.set(period.key, week);
  };
  for (const group of groups) {
    if (group.parent) { add(group.parent.completedAt, group); continue; }
    // Without a cached parent, place each completed child in its own actual week.
    const children = new Map<string, Task[]>(), matching = new Set(group.matches.map((task) => task.id));
    for (const child of group.children.filter((task) => matching.has(task.id))) {
      const key = completionWeek(child.completedAt).key;
      children.set(key, [...(children.get(key) || []), child]);
    }
    for (const rows of children.values()) add(rows[0].completedAt, { ...group, children: rows, matches: rows });
  }
  return [...weeks.values()].sort((a, b) => a.key === "unknown" ? b.key === "unknown" ? 0 : 1 : b.key === "unknown" ? -1 : b.key.localeCompare(a.key));
}
