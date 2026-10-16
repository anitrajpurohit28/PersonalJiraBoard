import { ensureTaskSchema, parseTaskId } from "../db/tasks";

export async function jiraTaskKey(params: Promise<{ id: string }>) {
  const id = parseTaskId((await params).id);
  if (!id) throw Object.assign(new Error("Invalid task."), { status: 400 });
  const db = await ensureTaskSchema();
  const row = await db.prepare("SELECT jira_key FROM tasks WHERE id = ? AND source = 'jira'").bind(id).first<{ jira_key: string }>();
  if (!row) throw Object.assign(new Error("Jira task not found."), { status: 404 });
  return row.jira_key;
}
