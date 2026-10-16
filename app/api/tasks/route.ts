import { cleanNotifyAt, cleanText, ensureTaskSchema } from "../../../db/tasks";
import { requestJiraHelper } from "../../../lib/jira-helper";
import { reminderEdit } from "../../../lib/task-reminders";
import { cacheJiraResult } from "../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../lib/local-request";
import { validLocalKey } from "../../../lib/jira-fields.mjs";

type TaskRow = {
  id: number; jira_key: string; jira_url: string; title: string; priority: number; status: string; source: string;
  jira_status: string | null; jira_priority: string | null; jira_assignee: string | null;
  notes: string; notify_at: string | null; notify_fired: number; manual_order: number | null;
  jira_status_id: string | null; jira_description: string | null; jira_priority_id: string | null; jira_assignee_id: string | null;
  jira_project_id: string | null; jira_project_key: string | null; jira_issue_type_id: string | null; jira_issue_type: string | null;
  jira_parent_key: string | null; jira_due_date: string | null; jira_labels: string | null; jira_updated_at: string | null;
  jira_sync_status: string | null; jira_sync_error: string | null; jira_is_subtask: number;
  jira_comments: string | null;
  archived: number; completed_at: string | null; created_at: string; updated_at: string;
};

export async function GET(request: Request) {
  try {
    const d1 = await ensureTaskSchema();
    const archived = new URL(request.url).searchParams.get("view") === "done" ? 1 : 0;
    const [tasks, updates] = await Promise.all([
      d1.prepare("SELECT * FROM tasks WHERE archived = ? AND (source = 'manual' OR jira_query_active = 1) ORDER BY manual_order IS NULL, manual_order, priority, id DESC").bind(archived).all<TaskRow>(),
      d1.prepare("SELECT task_updates.* FROM task_updates INNER JOIN tasks ON tasks.id = task_updates.task_id WHERE tasks.archived = ? ORDER BY task_updates.created_at DESC, task_updates.id DESC").bind(archived).all<{ id: number; task_id: number; body: string; created_at: string }>(),
    ]);
    return Response.json({ tasks: (tasks.results ?? []).map((row) => ({
      id: row.id, jiraKey: row.jira_key, jiraUrl: row.jira_url, title: row.title, priority: row.priority,
      status: row.status, source: row.source, state: row.jira_status, jiraPriority: row.jira_priority,
      jiraAssignee: row.jira_assignee, notes: row.notes, notifyAt: row.notify_at, notifyFired: Boolean(row.notify_fired),
      jiraStatusId: row.jira_status_id, description: row.jira_description || "", jiraPriorityId: row.jira_priority_id,
      jiraAssigneeId: row.jira_assignee_id, projectId: row.jira_project_id, projectKey: row.jira_project_key,
      issueTypeId: row.jira_issue_type_id, issueType: row.jira_issue_type, parentKey: row.jira_parent_key,
      dueDate: row.jira_due_date, labels: JSON.parse(row.jira_labels || "[]"), jiraUpdatedAt: row.jira_updated_at,
      syncStatus: row.jira_sync_status || "synced", syncError: row.jira_sync_error || "",
      isSubtask: Boolean(row.jira_is_subtask),
      comments: JSON.parse(row.jira_comments || "[]"),
      manualOrder: row.manual_order, archived: Boolean(row.archived), completedAt: row.completed_at,
      createdAt: row.created_at, updatedAt: row.updated_at,
      updates: (updates.results ?? []).filter((update) => update.task_id === row.id).map((update) => ({ id: update.id, body: update.body, createdAt: update.created_at })),
    })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load tasks." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const payload = await request.json();
    const d1 = await ensureTaskSchema();
    const result = await requestJiraHelper("create", "POST", { requestId: payload.requestId, projectId: payload.projectId, issueTypeId: payload.issueTypeId, fields: payload.fields, parentKey: payload.parentKey, subtasks: payload.subtasks });
    let warning = typeof result.warning === "string" ? result.warning : "";
    let id: number | undefined;
    try {
      await cacheJiraResult(result, { complete: false, createdLocally: true });
      id = (await d1.prepare("SELECT id FROM tasks WHERE (jira_key = ? OR jira_key = (SELECT jira_key FROM jira_task_aliases WHERE local_key = ?)) AND source = 'jira'").bind(result.key, result.key).first<{ id: number }>())?.id;
      const reminder = reminderEdit(payload.notifyAt === undefined ? undefined : cleanNotifyAt(payload.notifyAt));
      const assignments = [...(payload.notes === undefined ? [] : ["notes = ?"]), ...(reminder.sql ? [reminder.sql] : [])];
      if (id && assignments.length) await d1.prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...(payload.notes === undefined ? [] : [cleanText(payload.notes, 8000)]), ...reminder.params, id).run();
    } catch {
      warning = `${warning} The task is saved in the sync queue, but its local details could not be cached. Refresh before submitting again.`.trim();
    }
    return Response.json({ ok: true, id, jiraKey: result.key, jiraUrl: validLocalKey(result.key) ? "" : `${result.baseUrl}/browse/${result.key}`, pending: Boolean(result.pending), warning }, { status: 201 });
  } catch (error) { return errorResponse(error, "Unable to create task."); }
}
