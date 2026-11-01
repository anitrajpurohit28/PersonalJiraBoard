import { initialTaskStatus, issuePriority } from "./jira-personal.mjs";
import { adfText, normalizedDate, validLocalKey, validTaskKey } from "./jira-fields.mjs";

export type JiraIssue = {
  id: string; key: string;
  syncStatus?: string; syncError?: string; syncRevision?: number; syncDeleted?: boolean;
  cachedComments?: Array<{ id: string; body: string; author: string; createdAt: string; updatedAt: string; pending: boolean }>;
  fields: {
    summary?: string; description?: unknown;
    status?: { id?: string; name?: string; statusCategory?: { key?: string } };
    priority?: { id?: string; name?: string } | null;
    assignee?: { accountId?: string; displayName?: string } | null;
    reporter?: { accountId?: string; displayName?: string } | null;
    project?: { id?: string; key?: string };
    issuetype?: { id?: string; name?: string; subtask?: boolean };
    parent?: { key?: string } | null; duedate?: string | null; labels?: string[];
    created?: string; updated?: string; resolutiondate?: string | null; statuscategorychangedate?: string | null;
  };
};
type Existing = { id: number; jira_key: string; status: string; archived: number; jira_status_category: string | null };
export type JiraSyncScope = { kind: "personal" } | { kind: "board"; boardId: string };
export type SyncOptions = { complete?: boolean; snapshotStartedAt?: string; createdLocally?: boolean; revision?: number; aliases?: Record<string, string>; deletedKeys?: string[] };

export function planPersonalJiraSync(issues: JiraIssue[], existingRows: Existing[], baseUrl: string, accountId: string, syncedAt = new Date().toISOString(), scope: JiraSyncScope = { kind: "personal" }, options: SyncOptions = {}) {
  if (!accountId || (scope.kind === "board" && !/^[1-9]\d*$/.test(scope.boardId))) throw new Error("A verified Jira account and board are required.");
  const byKey = new Map(existingRows.map((row) => [row.jira_key, row]));
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let imported = 0, updated = 0;
  for (const issue of issues) {
    if (!validTaskKey(issue.key) || !issue.fields?.summary) throw new Error("Jira returned an invalid issue.");
    if (scope.kind === "personal" && issue.fields.assignee?.accountId !== accountId && issue.fields.reporter?.accountId !== accountId) throw new Error("Jira returned an issue belonging to another account.");
    const fields = issue.fields;
    const category = fields.status?.statusCategory?.key || "";
    const done = category === "done";
    const completedAt = done ? normalizedDate(fields.resolutiondate) || normalizedDate(fields.statuscategorychangedate) : null;
    const pendingUntil = options.createdLocally ? new Date(Date.parse(syncedAt) + 120000).toISOString() : null;
    const values = {
      jira_url: validLocalKey(issue.key) ? "" : `${baseUrl}/browse/${issue.key}`, title: (fields.summary || "").slice(0, 255), priority: issuePriority(issue),
      status: initialTaskStatus(issue), jira_status: fields.status?.name || "", jira_status_id: fields.status?.id || "",
      jira_status_category: category, jira_priority: fields.priority?.name || "", jira_priority_id: fields.priority?.id || null,
      jira_assignee: fields.assignee?.displayName || "", jira_assignee_id: fields.assignee?.accountId || null,
      jira_reporter: fields.reporter?.displayName || "", jira_created_at: normalizedDate(fields.created),
      jira_updated_at: normalizedDate(fields.updated), jira_synced_at: syncedAt,
      jira_description: adfText(fields.description).trimEnd(), jira_project_id: fields.project?.id || null,
      jira_project_key: fields.project?.key || null, jira_issue_type_id: fields.issuetype?.id || null,
      jira_issue_type: fields.issuetype?.name || null, jira_parent_key: fields.parent?.key || null,
      jira_is_subtask: fields.issuetype?.subtask ? 1 : 0,
      jira_comments: JSON.stringify(issue.cachedComments || []),
      jira_due_date: fields.duedate || null, jira_labels: JSON.stringify(fields.labels || []),
      archived: done ? 1 : 0, jira_query_active: issue.syncDeleted ? 0 : 1,
      jira_sync_status: issue.syncStatus || "synced", jira_sync_error: issue.syncError || "", jira_sync_revision: issue.syncRevision || 0,
    };
    const entries = Object.entries(values);
    const existing = byKey.get(issue.key);
    if (existing) {
      statements.push({ sql: `UPDATE tasks SET ${entries.map(([key]) => `${key} = ?`).join(", ")},
        completed_at = CASE WHEN ? = 1 THEN COALESCE(?, completed_at, ?) ELSE NULL END,
        ${done ? "notify_at = NULL, notify_fired = 0," : ""}
        updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ${issue.syncRevision ? "COALESCE(jira_sync_revision, 0) <= ?" : "(jira_updated_at IS NULL OR ? IS NULL OR jira_updated_at <= ?)"}`,
        params: [...entries.map(([, value]) => value), done ? 1 : 0, completedAt, syncedAt, existing.id, ...(issue.syncRevision ? [issue.syncRevision] : [values.jira_updated_at, values.jira_updated_at])] });
      updated++;
    } else {
      statements.push({ sql: `INSERT INTO tasks (jira_key, source, ${entries.map(([key]) => key).join(", ")}, completed_at, jira_pending_until)
        SELECT ?, 'jira', ${entries.map(() => "?").join(", ")}, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM jira_deleted_tasks WHERE jira_key = ?)
        ${validLocalKey(issue.key) ? "AND NOT EXISTS (SELECT 1 FROM jira_task_aliases WHERE local_key = ?)" : ""}
        ON CONFLICT(jira_key) DO NOTHING`,
        params: [issue.key, ...entries.map(([, value]) => value), done ? completedAt || syncedAt : null, pendingUntil, issue.key, ...(validLocalKey(issue.key) ? [issue.key] : [])] });
      imported++;
    }
  }
  if (options.complete !== false) {
    const found = new Set(issues.map((issue) => issue.key));
    const snapshotStartedAt = options.snapshotStartedAt || syncedAt;
    for (const row of existingRows) if (!found.has(row.jira_key)) statements.push({
      sql: `UPDATE tasks SET jira_query_active = 0 WHERE id = ? AND ${options.revision ? "COALESCE(jira_sync_revision, 0) <= ?" : "(jira_synced_at IS NULL OR jira_synced_at <= ?)"} AND (jira_pending_until IS NULL OR jira_pending_until <= ?)`,
      params: [row.id, options.revision || snapshotStartedAt, snapshotStartedAt],
    });
  }
  return { statements, imported, updated, total: issues.length, syncedAt };
}
