export type TaskTag = { id: string; name: string; shortcut: string | null };
export const personalTagSchema = [
  `CREATE TABLE IF NOT EXISTS personal_tags (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    shortcut TEXT UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0,
    jira_tag_id TEXT, jira_label TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS personal_task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES personal_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
  )`,
  "CREATE TABLE IF NOT EXISTS jira_tag_sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS personal_task_tags_tag_idx ON personal_task_tags (tag_id)",
];
const reserved = new Set(["a", "c", "q", "v", "x", "z"]);
export function validTagShortcut(key: string): boolean {
  return /^[a-z0-9=\-]$/.test(key) && !reserved.has(key);
}
export function parseTag(value: unknown) {
  const input = value as { name?: unknown; shortcut?: unknown } | null;
  const name = typeof input?.name === "string" ? input.name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  const shortcut = typeof input?.shortcut === "string" ? input.shortcut.trim().toLowerCase() : "";
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw Object.assign(new Error("Enter a tag name of 1–60 characters."), { status: 400 });
  if (input?.shortcut != null && typeof input.shortcut !== "string") throw Object.assign(new Error("Enter one letter, number, - or = for the shortcut, or leave it blank."), { status: 400 });
  if (shortcut && !validTagShortcut(shortcut)) throw Object.assign(new Error("Choose one letter, number, - or =. A, C, Q, V, X and Z keep their standard editing and quit shortcuts."), { status: 400 });
  return { name, nameKey: name.toLocaleLowerCase(), shortcut: shortcut || null };
}
export function tagForShortcut(tags: TaskTag[], event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; repeat?: boolean; isComposing?: boolean }) {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing) return undefined;
  const key = event.key.toLowerCase();
  return validTagShortcut(key) ? tags.find((tag) => tag.shortcut === key) : undefined;
}
export function parseTagIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) || new Set(value).size !== value.length) throw Object.assign(new Error("Invalid task tags."), { status: 400 });
  return value;
}
export function taskTagAssignment(taskId: number, tagId: string, assigned: boolean) {
  return assigned ? { sql: "INSERT OR IGNORE INTO personal_task_tags (task_id, tag_id) VALUES (?, ?)", params: [taskId, tagId] } : { sql: "DELETE FROM personal_task_tags WHERE task_id = ? AND tag_id = ?", params: [taskId, tagId] };
}
export function taskTagAliasStatements(local: string, remote: string) {
  return [{ sql: `INSERT OR IGNORE INTO personal_task_tags (task_id, tag_id)
    SELECT local.id, tagged.tag_id FROM tasks AS local, tasks AS remote
    JOIN personal_task_tags AS tagged ON tagged.task_id = remote.id
    WHERE local.jira_key = ? AND remote.jira_key = ?`, params: [local, remote] }];
}


export const tagOrderMigration = "ALTER TABLE personal_tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0";
export function tagOrderClause(alias?: "tags") {
  return ["sort_order", "name_key", "id"].map((column) => alias ? `${alias}.${column}` : column).join(", ");
}
export function tagCreationStatement(id: string, tag: ReturnType<typeof parseTag>) {
  return {
    sql: `INSERT INTO personal_tags (id, name, name_key, shortcut, sort_order)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM personal_tags))`,
    params: [id, tag.name, tag.nameKey, tag.shortcut],
  };
}
export function parseTagOrder(value: unknown, currentIds: string[]): string[] {
  const ids = parseTagIds((value as { ids?: unknown } | null)?.ids);
  const known = new Set(currentIds);
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) throw Object.assign(new Error("The tag list changed. Try moving the tag again."), { status: 409 });
  return ids;
}
export function tagOrderStatements(ids: string[]) {
  return ids.map((id, position) => ({ sql: "UPDATE personal_tags SET sort_order = ? WHERE id = ?", params: [position, id] }));
}
