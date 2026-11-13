import { ensureTaskSchema } from "./tasks";
import { initializeJiraAreas } from "../lib/jira-area-sync";
import { requestJiraHelper } from "../lib/jira-helper";
import { cacheJiraResult } from "../lib/jira-result";
import { storedAreas } from "./jira-areas";
import { areaCreationStatement, areaMoveStatements, parseArea, parseAreaId, type TaskArea, type AreaTask } from "../lib/task-areas";

type DB = Awaited<ReturnType<typeof ensureTaskSchema>>;
export async function listAreas(db?: DB) {
  const d1 = db || await ensureTaskSchema();
  return (await d1.prepare("SELECT id, name, disabled, sort_order AS sortOrder FROM personal_areas ORDER BY sort_order, name_key, id").all<TaskArea>()).results;
}
export async function areaTaskRows(d1: DB): Promise<AreaTask[]> {
  const result = await d1.prepare(`SELECT tasks.id, tasks.jira_key, tasks.jira_parent_key, assigned.area_id
    FROM tasks LEFT JOIN personal_task_areas AS assigned ON assigned.task_id = tasks.id`).all<{ id: number; jira_key: string; jira_parent_key: string | null; area_id: string | null }>();
  return result.results.map((row) => ({ id: row.id, jiraKey: row.jira_key, parentKey: row.jira_parent_key, areaId: row.area_id }));
}
export async function requireArea(value: unknown, d1: DB) {
  const id = parseAreaId(value);
  if (id && !await d1.prepare("SELECT id FROM personal_areas WHERE id = ?").bind(id).first()) throw Object.assign(new Error("This area no longer exists. Choose another area or Unassigned."), { status: 409 });
  return id;
}
export async function saveArea(payload: unknown, id?: string) {
  const { sync } = await initializeJiraAreas();
  if (sync.managed) throw Object.assign(new Error("Area choices are managed in Jira. Add or rename choices in your Jira Area field; the app imports them automatically."), { status: 400 });
  const value = parseArea(payload), d1 = await ensureTaskSchema();
  if (id && !await d1.prepare("SELECT id FROM personal_areas WHERE id = ?").bind(id).first()) throw Object.assign(new Error("Area not found."), { status: 404 });
  const areaId = id || crypto.randomUUID();
  try {
    if (id) await d1.prepare("UPDATE personal_areas SET name = ?, name_key = ? WHERE id = ?").bind(value.name, value.nameKey, id).run();
    else { const change = areaCreationStatement(areaId, value); await d1.prepare(change.sql).bind(...change.params).run(); }
  } catch (error) {
    if (/UNIQUE constraint failed/.test(String(error))) throw Object.assign(new Error("An area with this name already exists."), { status: 409 });
    throw error;
  }
  return { area: { id: areaId, name: value.name }, areas: await listAreas(d1) };
}
export async function moveToArea(ids: unknown, value: unknown, db?: DB) {
  const { sync, result } = await initializeJiraAreas();
  const d1 = db || await ensureTaskSchema(), areaId = await requireArea(value, d1);
  const move = areaMoveStatements(await areaTaskRows(d1), ids, areaId);
  if (sync.managed && result.areasMigrated) {
    if (!sync.ready) throw Object.assign(new Error(sync.message), { status: 400 });
    const option = areaId ? (await storedAreas(d1)).find((area) => area.id === areaId) : null;
    if (areaId && (!option?.jira_option_id || option.disabled)) throw Object.assign(new Error("Choose an available Area from Jira."), { status: 400 });
    const rows = (await d1.prepare("SELECT id, jira_key, source FROM tasks WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(move.ids)).all<{ id: number; jira_key: string; source: string }>()).results;
    const keys = rows.filter((row) => row.source === "jira").map((row) => row.jira_key);
    if (keys.length) await cacheJiraResult(await requestJiraHelper("areas-assign", "POST", { keys, optionId: option?.jira_option_id || null }));
    const localIds = rows.filter((row) => row.source !== "jira").map((row) => row.id);
    if (localIds.length) await d1.prepare("INSERT INTO personal_task_areas (task_id, area_id) SELECT value, ? FROM json_each(?) WHERE 1 ON CONFLICT(task_id) DO UPDATE SET area_id = excluded.area_id").bind(areaId, JSON.stringify(localIds)).run();
  } else await d1.batch(move.statements.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
  return { ok: true, ids: move.ids, areaId };
}
