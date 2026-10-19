import { cleanNotifyAt, cleanPriority, cleanText, ensureTaskSchema, isWorkflowStatus, parseTaskId } from "../../../../db/tasks";
import { requestJiraHelper } from "../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";
import { fireReminderStatement, reminderEdit } from "../../../../lib/task-reminders";

type Row = { id: number; source: string; jira_key: string; title: string; priority: number; status: string; notes: string; notify_at: string | null; notify_fired: number; archived: number; completed_at: string | null };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const id = parseTaskId((await context.params).id);
    if (!id) return Response.json({ error: "Invalid task id." }, { status: 400 });
    const d1 = await ensureTaskSchema();
    let current = await d1.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Row>();
    if (!current) return Response.json({ error: "Task not found." }, { status: 404 });
    const payload = await request.json();
    if (payload.notifyFired !== undefined) {
      if (payload.notifyFired !== true || typeof payload.expectedNotifyAt !== "string" || !cleanNotifyAt(payload.expectedNotifyAt) || Object.keys(payload).some((key) => !["notifyFired", "expectedNotifyAt"].includes(key))) return Response.json({ error: "Change or clear the reminder to reset it." }, { status: 400 });
      const statement = fireReminderStatement(id, payload.expectedNotifyAt);
      const result = await d1.prepare(statement.sql).bind(...statement.params).run();
      return Response.json({ ok: true, fired: Boolean(result.meta.changes) });
    }
    let reminder = reminderEdit(payload.notifyAt === undefined ? undefined : cleanNotifyAt(payload.notifyAt));
    let reminderSql = reminder.sql ? `, ${reminder.sql}` : "";
    let warning = "";
    if (current.source === "jira") {
      const action = payload.action || (payload.status === "done" ? "done" : payload.status === "now" ? "restore" : undefined);
      if (payload.title !== undefined || payload.priority !== undefined || (payload.status !== undefined && !["done", "now"].includes(payload.status))) return Response.json({ error: "Use Jira fields and workflow transitions to edit this task." }, { status: 400 });
      if ((payload.fields && Object.keys(payload.fields).length) || payload.targetStatusId || payload.targetColumnId || action) {
        const result = await requestJiraHelper("update", "POST", { key: current.jira_key, fields: payload.fields, baseFields: payload.baseFields, targetStatusId: payload.targetStatusId, targetColumnId: payload.targetColumnId, transitionFields: payload.transitionFields, expectedUpdatedAt: payload.expectedUpdatedAt, action });
        await cacheJiraResult(result, { complete: false });
        warning = typeof result.warning === "string" ? result.warning : "";
        current = await d1.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Row>() || current;
      }
      await d1.prepare(`UPDATE tasks SET notes = ?${reminderSql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(payload.notes === undefined ? current.notes : cleanText(payload.notes, 8000), ...reminder.params, id).run();
    } else {
      const title = payload.title === undefined ? current.title : cleanText(payload.title, 300);
      if (!title) return Response.json({ error: "Title is required." }, { status: 400 });
      const status = isWorkflowStatus(payload.status) ? payload.status : current.status;
      const done = status === "done";
      reminder = reminderEdit(done ? null : payload.notifyAt === undefined ? undefined : cleanNotifyAt(payload.notifyAt), done);
      reminderSql = reminder.sql ? `, ${reminder.sql}` : "";
      await d1.prepare(`UPDATE tasks SET title = ?, priority = ?, status = ?, notes = ?${reminderSql}, archived = ?,
        completed_at = ?, manual_order = CASE WHEN status = ? THEN manual_order ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
        title, payload.priority === undefined ? current.priority : cleanPriority(payload.priority), status,
        payload.notes === undefined ? current.notes : cleanText(payload.notes, 8000), ...reminder.params, done ? 1 : 0,
        done ? current.completed_at || new Date().toISOString() : null, status, id,
      ).run();
    }
    return Response.json({ ok: true, warning });
  } catch (error) { return errorResponse(error, "Unable to save task."); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const id = parseTaskId((await context.params).id);
    if (!id) return Response.json({ error: "Invalid task id." }, { status: 400 });
    const d1 = await ensureTaskSchema();
    const current = await d1.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Row>();
    if (!current) return Response.json({ error: "Task not found." }, { status: 404 });
    if (current.source === "jira") {
      const payload = await request.json();
      const result = await requestJiraHelper("delete", "POST", { key: current.jira_key, confirmDelete: payload.confirmDelete === true });
      await cacheJiraResult(result, { complete: false });
      return Response.json({ ok: true, pending: Boolean(result.pending) });
    }
    await d1.batch([d1.prepare("DELETE FROM task_updates WHERE task_id = ?").bind(id), d1.prepare("DELETE FROM tasks WHERE id = ?").bind(id)]);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error, "Unable to delete task."); }
}
