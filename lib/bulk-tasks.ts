export type BulkTaskAction = "done" | "delete";

export function parseBulkTaskRequest(payload: unknown): {
  action: BulkTaskAction;
  ids: number[];
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("A bulk action and task IDs are required.");
  }
  const { action, ids } = payload as Record<string, unknown>;
  if (action !== "done" && action !== "delete") {
    throw new Error("Choose done or delete.");
  }
  if (!Array.isArray(ids) || ids.length === 0 ||
      ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Select at least one valid task.");
  }
  return { action, ids: [...new Set(ids)] };
}

export function orderJiraDeletion<T extends { jira_key: string; jira_parent_key: string | null }>(rows: T[]): T[] {
  const children = new Map<string, T[]>();
  for (const row of rows) {
    if (row.jira_parent_key) children.set(row.jira_parent_key, [...(children.get(row.jira_parent_key) || []), row]);
  }
  const visited = new Set<string>();
  const ordered: T[] = [];
  function append(row: T) {
    if (visited.has(row.jira_key)) return;
    visited.add(row.jira_key);
    for (const child of children.get(row.jira_key) || []) append(child);
    ordered.push(row);
  }
  rows.forEach(append);
  return ordered;
}

export function bulkTaskStatements(action: BulkTaskAction, ids: number[], completedAt: string) {
  // One JSON parameter avoids SQLite/D1's bind limit for large selections.
  const selectedIds = JSON.stringify(ids);
  const selection = "SELECT value FROM json_each(?)";
  if (action === "delete") {
    return [
      { sql: `DELETE FROM task_updates WHERE task_id IN (${selection})`, params: [selectedIds] },
      { sql: `DELETE FROM tasks WHERE id IN (${selection})`, params: [selectedIds] },
    ];
  }
  return [{
    sql: `UPDATE tasks SET
      status = 'done', archived = 1, notify_at = NULL, notify_fired = 0,
      completed_at = CASE WHEN archived = 1 AND completed_at IS NOT NULL
        THEN completed_at ELSE ? END,
      manual_order = CASE WHEN status = 'done' THEN manual_order ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${selection})`,
    params: [completedAt, selectedIds],
  }];
}
