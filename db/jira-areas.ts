import { ensureTaskSchema } from "./tasks";
import { areaCacheStatements, type StoredArea } from "../lib/jira-area-cache";
import { resolvedTaskAreas } from "../lib/task-areas";

type DB = Awaited<ReturnType<typeof ensureTaskSchema>>;
export async function storedAreas(d1: DB) { return (await d1.prepare("SELECT * FROM personal_areas ORDER BY sort_order, name_key, id").all<StoredArea>()).results; }
export async function areaSeed(d1: DB) {
  const areas = await storedAreas(d1);
  const rows = (await d1.prepare("SELECT tasks.id, tasks.jira_key AS jiraKey, tasks.jira_parent_key AS parentKey, assigned.area_id AS areaId FROM tasks LEFT JOIN personal_task_areas assigned ON assigned.task_id = tasks.id WHERE tasks.source = 'jira'").all<{ id: number; jiraKey: string; parentKey: string | null; areaId: string | null }>()).results;
  const resolved = resolvedTaskAreas(rows);
  return { areas: areas.map(({ id, name }) => ({ id, name })), assignments: rows.map((row) => ({ key: row.jiraKey, areaId: resolved.get(row.id) || null })) };
}
export async function mergeJiraAreas(d1: DB, catalog: unknown, issues: Array<{ key: string; fields: Record<string, unknown> }>, revision: number) {
  const changes = areaCacheStatements(await storedAreas(d1), catalog, issues, revision);
  if (changes.length) await d1.batch(changes.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
}
