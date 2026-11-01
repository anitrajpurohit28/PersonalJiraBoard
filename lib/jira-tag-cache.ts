import { readTagCatalog } from "./jira-tags.mjs";
export type StoredTag = { id: string; name: string; name_key: string; shortcut: string | null; sort_order: number; jira_tag_id: string | null; jira_label: string | null };
type Statement = { sql: string; params: Array<string | number | null> };
// Every statement checks the durable helper revision, so a slow response cannot undo newer tag edits.
export function tagCacheStatements(previous: StoredTag[], value: unknown, revision: number): Statement[] {
  const catalog = readTagCatalog(value), retained = new Set<string>(), statements: Statement[] = [];
  const guard = "? >= COALESCE((SELECT revision FROM jira_tag_sync_state WHERE id = 1), 0)";
  for (const tag of catalog.tags) {
    const old = previous.find((entry) => entry.jira_tag_id === tag.id || entry.id === tag.id) || previous.find((entry) => entry.jira_label === tag.label || (!entry.jira_tag_id && entry.name_key === tag.name.toLowerCase()));
    const id = old?.id || tag.id;
    retained.add(id);
    if (old) statements.push({ sql: `UPDATE personal_tags SET name = ?, name_key = ?, jira_tag_id = ?, jira_label = ? WHERE id = ? AND ${guard}`, params: [tag.name, tag.name.toLowerCase(), tag.id, tag.label, id, revision] });
    else statements.push({ sql: `INSERT OR IGNORE INTO personal_tags (id, name, name_key, shortcut, sort_order, jira_tag_id, jira_label)
      SELECT ?, ?, ?, NULL, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM personal_tags), ?, ? WHERE ${guard}`, params: [id, tag.name, tag.name.toLowerCase(), tag.id, tag.label, revision] });
  }
  for (const tag of previous) if (!retained.has(tag.id)) statements.push({ sql: `DELETE FROM personal_tags WHERE id = ? AND ${guard}`, params: [tag.id, revision] });
  statements.push(
    { sql: `DELETE FROM personal_task_tags WHERE task_id IN (SELECT id FROM tasks WHERE source = 'jira') AND ${guard}`, params: [revision] },
    { sql: `INSERT OR IGNORE INTO personal_task_tags (task_id, tag_id)
      SELECT tasks.id, tags.id FROM tasks JOIN json_each(COALESCE(tasks.jira_labels, '[]')) labels
      JOIN personal_tags tags ON tags.jira_label = labels.value WHERE tasks.source = 'jira' AND ${guard}`, params: [revision] },
    { sql: "INSERT INTO jira_tag_sync_state (id, revision) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET revision = MAX(revision, excluded.revision)", params: [revision] },
  );
  return statements;
}
