import { validDescriptionFormat, descriptionFormatUpdate } from "../../../lib/description-format.mjs";
import { cleanNotifyAt, cleanText, ensureTaskSchema } from "../../../db/tasks";
import { requestJiraHelper } from "../../../lib/jira-helper";
import { reminderEdit } from "../../../lib/task-reminders";
import { cacheJiraResult } from "../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../lib/local-request";
import { parseTagIds, taskTagAssignment, tagOrderClause, type TaskTag } from "../../../lib/task-tags";
import { initializeJiraTags } from "../../../lib/jira-tag-sync";
import { storedTags } from "../../../db/jira-tags";
import { listTags } from "../../../db/tags";
import { areaTaskRows, requireArea } from "../../../db/areas";
import { resolvedTaskAreas, initialTaskAreaStatement } from "../../../lib/task-areas";
import { initializeJiraAreas } from "../../../lib/jira-area-sync";
import { storedAreas } from "../../../db/jira-areas";
import { validLocalKey } from "../../../lib/jira-fields.mjs";

type TaskRow = {
  description_format: "todo" | "text" | null; id: number; jira_key: string; jira_url: string; title: string; priority: number; status: string; source: string;
  jira_status: string | null; jira_priority: string | null; jira_assignee: string | null;
  notes: string; notify_at: string | null; notify_fired: number; manual_order: number | null;
  jira_status_id: string | null; jira_description: string | null; jira_priority_id: string | null; jira_assignee_id: string | null;
  jira_project_id: string | null; jira_project_key: string | null; jira_issue_type_id: string | null; jira_issue_type: string | null;
  jira_parent_key: string | null; jira_due_date: string | null; jira_labels: string | null; jira_created_at: string | null; jira_updated_at: string | null;
  jira_sync_status: string | null; jira_sync_error: string | null; jira_is_subtask: number;
  jira_comments: string | null;
  archived: number; completed_at: string | null; created_at: string; updated_at: string;
};

export async function GET(request: Request) {
  try {
    const d1 = await ensureTaskSchema();
    const archived = new URL(request.url).searchParams.get("view") === "done" ? 1 : 0;
    const [tasks, updates, tags, areaRows] = await Promise.all([
      d1.prepare("SELECT * FROM tasks WHERE archived = ? AND (source = 'manual' OR jira_query_active = 1) ORDER BY manual_order IS NULL, manual_order, priority, id DESC").bind(archived).all<TaskRow>(),
      d1.prepare("SELECT task_updates.* FROM task_updates INNER JOIN tasks ON tasks.id = task_updates.task_id WHERE tasks.archived = ? ORDER BY task_updates.created_at DESC, task_updates.id DESC").bind(archived).all<{ id: number; task_id: number; body: string; created_at: string }>(),
      d1.prepare(`SELECT tags.id, tags.name, tags.shortcut, assigned.task_id FROM personal_tags AS tags JOIN personal_task_tags AS assigned ON assigned.tag_id = tags.id JOIN tasks ON tasks.id = assigned.task_id WHERE tasks.archived = ? ORDER BY ${tagOrderClause("tags")}`).bind(archived).all<TaskTag & { task_id: number }>(),
      areaTaskRows(d1),
    ]);
    const areas = resolvedTaskAreas(areaRows);
    return Response.json({ tasks: (tasks.results ?? []).map((row) => ({
      id: row.id, jiraKey: row.jira_key, jiraUrl: row.jira_url, title: row.title, priority: row.priority,
      status: row.status, source: row.source, state: row.jira_status, jiraPriority: row.jira_priority,
      jiraAssignee: row.jira_assignee, notes: row.notes, notifyAt: row.notify_at, notifyFired: Boolean(row.notify_fired),
      jiraStatusId: row.jira_status_id, description: row.jira_description || "", descriptionFormat: row.description_format, jiraPriorityId: row.jira_priority_id,
      jiraAssigneeId: row.jira_assignee_id, projectId: row.jira_project_id, projectKey: row.jira_project_key,
      issueTypeId: row.jira_issue_type_id, issueType: row.jira_issue_type, parentKey: row.jira_parent_key,
      dueDate: row.jira_due_date, labels: JSON.parse(row.jira_labels || "[]"), jiraUpdatedAt: row.jira_updated_at,
      syncStatus: row.jira_sync_status || "synced", syncError: row.jira_sync_error || "",
      isSubtask: Boolean(row.jira_is_subtask),
      areaId: areas.get(row.id) || null,
      tags: tags.results.filter((tag) => tag.task_id === row.id).map(({ id, name, shortcut }) => ({ id, name, shortcut })),
      comments: JSON.parse(row.jira_comments || "[]"),
      manualOrder: row.manual_order, archived: Boolean(row.archived), completedAt: row.completed_at,
      createdAt: row.created_at, jiraCreatedAt: row.jira_created_at, updatedAt: row.updated_at,
      updates: (updates.results ?? []).filter((update) => update.task_id === row.id).map((update) => ({ id: update.id, body: update.body, createdAt: update.created_at })),
    })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load tasks." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const payload = await request.json();
    const format = validDescriptionFormat(payload.descriptionFormat ?? "todo");
    if (payload.subtasks !== undefined && !Array.isArray(payload.subtasks)) throw Object.assign(new Error("Subtasks must be a list."), {status:400});
    for (const child of payload.subtasks || []) validDescriptionFormat(child.descriptionFormat ?? "todo");
    const d1 = await ensureTaskSchema();
    const areaState = await initializeJiraAreas();
    if (areaState.result.areasMigrated && !areaState.sync.ready) return Response.json({ error: areaState.sync.message }, { status: 400 });
    const areaId = await requireArea(payload.areaId ?? null, d1);
    const selectedArea = areaId ? (await storedAreas(d1)).find((area) => area.id === areaId) : null;
    if (areaState.result.areasMigrated && selectedArea?.disabled) return Response.json({ error: "Choose an available Area from Jira." }, { status: 400 });
    const tagIds = parseTagIds(payload.tagIds || []);
    await initializeJiraTags();
    const knownTags = await listTags(d1);
    if (tagIds.some((id) => !knownTags.some((tag) => tag.id === id))) return Response.json({ error: "A selected tag no longer exists." }, { status: 400 });
    const selectedTags = (await storedTags(d1)).filter((tag) => tagIds.includes(tag.id));
    if (payload.tagIds !== undefined && payload.fields?.labels !== undefined && !Array.isArray(payload.fields.labels)) return Response.json({ error: "Labels must be a list." }, { status: 400 });
    const fields = { ...payload.fields, ...(payload.tagIds !== undefined ? { labels: [...new Set([...(payload.fields?.labels || []), ...selectedTags.map((tag) => tag.jira_label!)])] } : {}) };
    const result = await requestJiraHelper("create", "POST", { requestId: payload.requestId, projectId: payload.projectId, issueTypeId: payload.issueTypeId, fields, areaOptionId: selectedArea?.jira_option_id || null, parentKey: payload.parentKey, subtasks: payload.subtasks?.map((child: {requestId:string;fields:unknown}) => ({ requestId:child.requestId,fields:child.fields })) });
    let warning = typeof result.warning === "string" ? result.warning : "";
    let id: number | undefined;
    try {
      await cacheJiraResult(result, { complete: false, createdLocally: true });
      id = (await d1.prepare("SELECT id FROM tasks WHERE (jira_key = ? OR jira_key = (SELECT jira_key FROM jira_task_aliases WHERE local_key = ?)) AND source = 'jira'").bind(result.key, result.key).first<{ id: number }>())?.id;
      if (id) { const change = descriptionFormatUpdate(id,format); await d1.prepare(change.sql).bind(...change.params).run(); }
      for (const child of payload.subtasks || []) {
        const key = `local:${child.requestId}`;
        const row = await d1.prepare("SELECT id FROM tasks WHERE jira_key = ? OR jira_key = (SELECT jira_key FROM jira_task_aliases WHERE local_key = ?)").bind(key,key).first<{id:number}>();
        if (row) { const change = descriptionFormatUpdate(row.id,child.descriptionFormat ?? "todo"); await d1.prepare(change.sql).bind(...change.params).run(); }
      }
      const reminder = reminderEdit(payload.notifyAt === undefined ? undefined : cleanNotifyAt(payload.notifyAt));
      const assignments = [...(payload.notes === undefined ? [] : ["notes = ?"]), ...(reminder.sql ? [reminder.sql] : [])];
      if (id && assignments.length) await d1.prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...(payload.notes === undefined ? [] : [cleanText(payload.notes, 8000)]), ...reminder.params, id).run();
      if (!areaState.result.areasMigrated && id && !(result.issue as { fields?: { parent?: { key?: string } } } | undefined)?.fields?.parent?.key) {
        const assignment = initialTaskAreaStatement(id, areaId);
        await d1.prepare(assignment.sql).bind(...assignment.params).run();
      }
      if (id && tagIds.length) await d1.batch(tagIds.map((tagId) => { const change = taskTagAssignment(id!, tagId, true); return d1.prepare(change.sql).bind(...change.params); }));
    } catch {
      warning = `${warning} The task is saved in the sync queue, but its local details could not be cached. Refresh before submitting again.`.trim();
    }
    return Response.json({ ok: true, id, jiraKey: result.key, jiraUrl: validLocalKey(result.key) ? "" : `${result.baseUrl}/browse/${result.key}`, pending: Boolean(result.pending), warning }, { status: 201 });
  } catch (error) { return errorResponse(error, "Unable to create task."); }
}
