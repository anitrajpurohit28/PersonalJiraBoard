import { validIssueKey, validLocalKey, validTaskKey } from "./jira-fields.mjs";

export function resolveCachedJiraIssues(issues, aliases, deletedKeys) {
  const removed = new Set(deletedKeys);
  return issues.map((issue) => ({ ...issue, key: aliases[issue.key] || issue.key, fields: { ...issue.fields,
    ...(issue.fields.parent ? { parent: { ...issue.fields.parent, key: aliases[issue.fields.parent.key] || issue.fields.parent.key } } : {}),
  } })).filter((issue) => !removed.has(issue.key));
}

export function jiraCacheChanges(aliases = {}, deletedKeys = []) {
  const statements = [];
  for (const [local, remote] of Object.entries(aliases)) {
    if (!validLocalKey(local) || !validIssueKey(remote)) throw new Error("Invalid Jira task mapping.");
    statements.push(
      { sql: "INSERT OR REPLACE INTO jira_task_aliases (local_key, jira_key) VALUES (?, ?)", params: [local, remote] },
      { sql: "UPDATE task_updates SET task_id = (SELECT id FROM tasks WHERE jira_key = ?) WHERE task_id = (SELECT id FROM tasks WHERE jira_key = ?) AND EXISTS (SELECT 1 FROM tasks WHERE jira_key = ?)", params: [local, remote, local] },
      { sql: "UPDATE tasks SET notes = CASE WHEN notes = '' THEN COALESCE((SELECT notes FROM tasks WHERE jira_key = ?), '') ELSE notes END WHERE jira_key = ?", params: [remote, local] },
      { sql: "DELETE FROM tasks WHERE jira_key = ? AND source = 'jira' AND EXISTS (SELECT 1 FROM tasks WHERE jira_key = ?)", params: [remote, local] },
      { sql: "UPDATE tasks SET jira_key = ? WHERE jira_key = ? AND source = 'jira'", params: [remote, local] },
      { sql: "UPDATE tasks SET jira_parent_key = ? WHERE jira_parent_key = ? AND source = 'jira'", params: [remote, local] },
    );
  }
  for (const key of new Set(deletedKeys)) {
    if (!validTaskKey(key)) throw new Error("Invalid deleted task mapping.");
    statements.push(
      { sql: "INSERT OR IGNORE INTO jira_deleted_tasks (jira_key) VALUES (?)", params: [key] },
      { sql: "DELETE FROM task_updates WHERE task_id IN (SELECT id FROM tasks WHERE jira_key = ? AND source = 'jira')", params: [key] },
      { sql: "DELETE FROM tasks WHERE jira_key = ? AND source = 'jira'", params: [key] },
    );
  }
  return statements;
}
