import { readAreaCatalog, areaNameKey, areaOptionId } from "./jira-areas.mjs";
export type StoredArea = { id: string; name: string; name_key: string; sort_order: number; jira_field_id: string | null; jira_option_id: string | null; disabled: number };
type Statement = { sql: string; params: Array<string | number | null> };
export function areaCacheStatements(previous: StoredArea[], value: unknown, issues: Array<{ key: string; fields: Record<string, unknown> }>, revision: number): Statement[] {
  const catalog = readAreaCatalog(value);
  if (!catalog.ready || !catalog.fieldId) return [];
  const guard = "? >= COALESCE((SELECT revision FROM jira_area_sync_state WHERE id = 1), 0)";
  const statements: Statement[] = [], retained = new Set<string>();
  const mapping = new Map<string, string>();
  const entries = catalog.options.map((option: { id: string; name: string; disabled: boolean }) => {
    const old = previous.find((area) => area.jira_field_id === catalog.fieldId && area.jira_option_id === option.id) || previous.find((area) => !area.jira_option_id && area.name_key === areaNameKey(option.name));
    const id = old?.id || `jira-area-${catalog.fieldId!.slice(12)}-${option.id}`;
    retained.add(id); mapping.set(option.id, id); return { option, old, id };
  });
  for (const { old, option } of entries) if (old && old.name_key !== areaNameKey(option.name)) statements.push({ sql: `UPDATE personal_areas SET name_key = ? WHERE id = ? AND ${guard}`, params: [`area-migration:${old.id}`, old.id, revision] });
  for (const area of previous) if (!retained.has(area.id) && area.jira_field_id === catalog.fieldId) statements.push({ sql: `DELETE FROM personal_areas WHERE id = ? AND ${guard}`, params: [area.id, revision] });
  for (const { option, old, id } of entries) {
    if (old) statements.push({ sql: `UPDATE personal_areas SET name = ?, name_key = ?, jira_field_id = ?, jira_option_id = ?, disabled = ? WHERE id = ? AND ${guard}`, params: [option.name, areaNameKey(option.name), catalog.fieldId, option.id, option.disabled ? 1 : 0, id, revision] });
    else statements.push({ sql: `INSERT OR IGNORE INTO personal_areas (id, name, name_key, sort_order, jira_field_id, jira_option_id, disabled) SELECT ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM personal_areas), ?, ?, ? WHERE ${guard}`, params: [id, option.name, areaNameKey(option.name), catalog.fieldId, option.id, option.disabled ? 1 : 0, revision] });
  }
  for (const issue of issues) if (Object.hasOwn(issue.fields, catalog.fieldId)) {
    const optionId = areaOptionId(issue.fields[catalog.fieldId]), areaId = optionId ? mapping.get(optionId) : null;
    // Unknown choices must not erase an existing assignment while metadata catches up.
    if (optionId && !areaId) continue;
    statements.push({ sql: `INSERT INTO personal_task_areas (task_id, area_id) SELECT id, ? FROM tasks WHERE source = 'jira' AND (jira_key = ? OR jira_key = (SELECT jira_key FROM jira_task_aliases WHERE local_key = ?)) AND ${guard} ON CONFLICT(task_id) DO UPDATE SET area_id = excluded.area_id`, params: [areaId || null, issue.key, issue.key, revision] });
  }
  statements.push({ sql: "INSERT INTO jira_area_sync_state (id, revision, field_id) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = MAX(revision, excluded.revision), field_id = CASE WHEN excluded.revision >= revision THEN excluded.field_id ELSE field_id END", params: [revision, catalog.fieldId] });
  return statements;
}
