export type TaskArea = { id: string; name: string; disabled?: boolean };
export type AreaSyncInfo = { managed: boolean; ready: boolean; message: string };
export type AreaTask = { id: number; jiraKey: string; parentKey: string | null; areaId: string | null };
export const personalAreaSchema = [
  `CREATE TABLE IF NOT EXISTS personal_areas (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0, jira_field_id TEXT, jira_option_id TEXT, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS personal_task_areas (
    task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    area_id TEXT REFERENCES personal_areas(id) ON DELETE SET NULL
  )`,
  "CREATE INDEX IF NOT EXISTS personal_task_areas_area_idx ON personal_task_areas (area_id)",
  "CREATE TABLE IF NOT EXISTS jira_area_sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, field_id TEXT)",
];
const invalid = (message: string, status = 400) => Object.assign(new Error(message), { status });
export function parseArea(value: unknown) {
  const raw = (value as { name?: unknown } | null)?.name;
  const name = typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw invalid("Enter an area name of 1–60 characters.");
  if (name.toLocaleLowerCase() === "unassigned") throw invalid("Unassigned is already available for tasks without an area.");
  return { name, nameKey: name.toLocaleLowerCase() };
}
export function parseAreaId(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw invalid("Choose an existing area or Unassigned.");
  return value;
}
export function areaCreationStatement(id: string, area: ReturnType<typeof parseArea>) {
  return { sql: `INSERT INTO personal_areas (id, name, name_key, sort_order)
    VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM personal_areas))`, params: [id, area.name, area.nameKey] };
}
// Area ownership follows the root task, including completed or currently hidden parents.
// Orphaned siblings stay together; a cycle uses one stable representative.
export function areaTaskGroups(rows: AreaTask[]) {
  const byKey = new Map(rows.map((row) => [row.jiraKey, row]));
  const groups = new Map<string, AreaTask[]>();
  for (const row of rows) {
    let root = row;
    const path: AreaTask[] = [], seen = new Map<string, number>();
    while (root.parentKey && byKey.has(root.parentKey) && !seen.has(root.jiraKey)) {
      seen.set(root.jiraKey, path.length); path.push(root); root = byKey.get(root.parentKey)!;
    }
    if (seen.has(root.jiraKey)) root = path.slice(seen.get(root.jiraKey)).sort((a, b) => a.id - b.id)[0];
    const key = root.parentKey && !byKey.has(root.parentKey) ? `parent:${root.parentKey}` : root.jiraKey;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups].map(([key, tasks]) => ({ root: byKey.get(key) || [...tasks].sort((a, b) => a.id - b.id)[0], tasks }));
}
export function resolvedTaskAreas(rows: AreaTask[]) {
  return new Map(areaTaskGroups(rows).flatMap(({ root, tasks }) => tasks.map((task) => [task.id, root.areaId || null] as const)));
}
export function areaMoveStatements(rows: AreaTask[], ids: unknown, areaId: string | null) {
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) throw invalid("Select at least one valid task to move.");
  const selected = new Set<number>(ids);
  if ([...selected].some((id) => !rows.some((row) => row.id === id))) throw invalid("A selected task is no longer available. Refresh and try again.", 409);
  const moved = areaTaskGroups(rows).filter(({ tasks }) => tasks.some((row) => selected.has(row.id))).flatMap(({ tasks }) => tasks.map((row) => row.id));
  return { ids: moved, statements: [{ sql: `INSERT INTO personal_task_areas (task_id, area_id)
    SELECT value, ? FROM json_each(?) WHERE 1
    ON CONFLICT(task_id) DO UPDATE SET area_id = excluded.area_id`, params: [areaId, JSON.stringify(moved)] }] };
}
export function taskAreaAliasStatements(local: string, remote: string) {
  return [{ sql: `INSERT OR IGNORE INTO personal_task_areas (task_id, area_id)
    SELECT local.id, assigned.area_id FROM tasks AS local, tasks AS remote
    JOIN personal_task_areas AS assigned ON assigned.task_id = remote.id
    WHERE local.jira_key = ? AND remote.jira_key = ?`, params: [local, remote] }];
}

// Creation retries must not overwrite an Area the user subsequently changed.
export function initialTaskAreaStatement(taskId: number, areaId: string | null) {
  return { sql: "INSERT OR IGNORE INTO personal_task_areas (task_id, area_id) VALUES (?, ?)", params: [taskId, areaId] };
}
