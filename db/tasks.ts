import { getD1 } from "./index";
import { jiraDateMigrations } from "../lib/jira-fields.mjs";

export type WorkflowStatus = "now" | "waiting" | "later" | "confirmation" | "done";
export type TaskPriority = 1 | 2 | 3 | 4;

export async function ensureTaskSchema() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, jira_key TEXT NOT NULL, jira_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL DEFAULT 'now',
      source TEXT NOT NULL DEFAULT 'manual', jira_status TEXT, jira_status_category TEXT, jira_priority TEXT,
      jira_assignee TEXT, jira_reporter TEXT, jira_created_at TEXT, jira_updated_at TEXT, jira_synced_at TEXT,
      jira_query_active INTEGER NOT NULL DEFAULT 1, manual_order INTEGER, notify_at TEXT,
      notify_fired INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS task_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS tasks_active_priority_idx ON tasks (archived, status, priority)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS task_updates_task_date_idx ON task_updates (task_id, created_at)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS task_migrations (name TEXT PRIMARY KEY)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS jira_task_aliases (local_key TEXT PRIMARY KEY, jira_key TEXT NOT NULL)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS jira_deleted_tasks (jira_key TEXT PRIMARY KEY)"),
  ]);
  const result = await d1.prepare("PRAGMA table_info(tasks)").all<{ name: string }>();
  const columns = new Set((result.results ?? []).map((column) => column.name));
  for (const name of ["jira_status_category", "jira_status_id", "jira_description", "jira_priority_id", "jira_assignee_id", "jira_project_id", "jira_project_key", "jira_issue_type_id", "jira_issue_type", "jira_parent_key", "jira_due_date", "jira_labels", "jira_pending_until", "jira_sync_status", "jira_sync_error", "jira_sync_revision", "jira_is_subtask", "jira_comments"]) {
    if (!columns.has(name)) {
      try { await d1.prepare(`ALTER TABLE tasks ADD COLUMN ${name} ${["jira_sync_revision", "jira_is_subtask"].includes(name) ? "INTEGER NOT NULL DEFAULT 0" : "TEXT"}`).run(); }
      catch (error) { if (!String(error).includes("duplicate column")) throw error; }
    }
  }
  await d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS tasks_jira_key_idx ON tasks (jira_key)").run();
  const migrated = await d1.prepare("SELECT name FROM task_migrations WHERE name = 'jira-timestamps-v1'").first();
  if (!migrated) {
    const rows = await d1.prepare("SELECT id, jira_updated_at, jira_created_at FROM tasks WHERE source = 'jira'").all<{ id: number; jira_updated_at: string | null; jira_created_at: string | null }>();
    const changes = jiraDateMigrations(rows.results || []);
    await d1.batch([
      ...changes.map((row: { id: number; previous: string | null; updatedAt: string | null; createdAt: string | null }) => d1.prepare("UPDATE tasks SET jira_updated_at = ?, jira_created_at = ? WHERE id = ? AND jira_updated_at IS ?").bind(row.updatedAt, row.createdAt, row.id, row.previous)),
      d1.prepare("INSERT OR IGNORE INTO task_migrations (name) VALUES ('jira-timestamps-v1')"),
    ]);
  }
  return d1;
}
export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return ["now", "waiting", "later", "confirmation", "done"].includes(String(value));
}
export function cleanText(value: unknown, maxLength = 500) { return typeof value === "string" ? value.trim().slice(0, maxLength) : ""; }
export function cleanPriority(value: unknown): TaskPriority {
  const parsed = Number(value); return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 ? parsed : 3;
}
export function cleanNotifyAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export function parseTaskId(raw: string) {
  const id = Number(raw); return Number.isSafeInteger(id) && id > 0 ? id : null;
}
