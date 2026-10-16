import {
  cleanText,
  ensureTaskSchema,
  parseTaskId,
} from "../../../../../db/tasks";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await context.params;
    const id = parseTaskId(rawId);
    if (!id) {
      return Response.json({ error: "Invalid task id." }, { status: 400 });
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const body = cleanText(payload.body, 1000);
    if (!body) {
      return Response.json({ error: "Update cannot be empty." }, { status: 400 });
    }

    const d1 = await ensureTaskSchema();
    const task = await d1
      .prepare("SELECT id FROM tasks WHERE id = ?")
      .bind(id)
      .first<{ id: number }>();
    if (!task) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }

    await d1.batch([
      d1
        .prepare("INSERT INTO task_updates (task_id, body) VALUES (?, ?)")
        .bind(id, body),
      d1
        .prepare("UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(id),
    ]);

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add update";
    return Response.json({ error: message }, { status: 500 });
  }
}
