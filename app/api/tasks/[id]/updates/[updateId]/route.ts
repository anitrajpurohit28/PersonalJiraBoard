import {
  cleanText,
  ensureTaskSchema,
  parseTaskId,
} from "../../../../../../db/tasks";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; updateId: string }> }
) {
  try {
    const { id: rawTaskId, updateId: rawUpdateId } = await context.params;
    const taskId = parseTaskId(rawTaskId);
    const updateId = parseTaskId(rawUpdateId);

    if (!taskId || !updateId) {
      return Response.json({ error: "Invalid update id." }, { status: 400 });
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const body = cleanText(payload.body, 1000);
    if (!body) {
      return Response.json({ error: "Update cannot be empty." }, { status: 400 });
    }

    const d1 = await ensureTaskSchema();
    const update = await d1
      .prepare(
        "SELECT id FROM task_updates WHERE id = ? AND task_id = ?"
      )
      .bind(updateId, taskId)
      .first<{ id: number }>();

    if (!update) {
      return Response.json({ error: "Update not found." }, { status: 404 });
    }

    await d1.batch([
      d1
        .prepare(
          "UPDATE task_updates SET body = ? WHERE id = ? AND task_id = ?"
        )
        .bind(body, updateId, taskId),
      d1
        .prepare(
          "UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .bind(taskId),
    ]);

    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update comment";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; updateId: string }> }
) {
  try {
    const { id: rawTaskId, updateId: rawUpdateId } = await context.params;
    const taskId = parseTaskId(rawTaskId);
    const updateId = parseTaskId(rawUpdateId);

    if (!taskId || !updateId) {
      return Response.json({ error: "Invalid update id." }, { status: 400 });
    }

    const d1 = await ensureTaskSchema();
    const update = await d1
      .prepare(
        "SELECT id FROM task_updates WHERE id = ? AND task_id = ?"
      )
      .bind(updateId, taskId)
      .first<{ id: number }>();

    if (!update) {
      return Response.json({ error: "Update not found." }, { status: 404 });
    }

    await d1.batch([
      d1
        .prepare("DELETE FROM task_updates WHERE id = ? AND task_id = ?")
        .bind(updateId, taskId),
      d1
        .prepare(
          "UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .bind(taskId),
    ]);

    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to delete update";
    return Response.json({ error: message }, { status: 500 });
  }
}
