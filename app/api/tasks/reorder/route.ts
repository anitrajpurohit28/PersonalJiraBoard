import { ensureTaskSchema } from "../../../../db/tasks";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";
import { parseTaskOrder, taskOrderStatements } from "../../../../lib/task-order";

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    let order;
    try { order = parseTaskOrder(await request.json()); }
    catch { return Response.json({ error: "The card order is invalid." }, { status: 400 }); }
    const { ids, parentKey } = order;
    const d1 = await ensureTaskSchema();
    const result = await d1.prepare("SELECT id, jira_parent_key, archived FROM tasks WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(ids)).all<{ id: number; jira_parent_key: string | null; archived: number }>();
    if (result.results.length !== ids.length || result.results.some((row) => row.jira_parent_key !== parentKey || (parentKey === null && row.archived))) {
      return Response.json({ error: "The board changed while you were dragging. Try again." }, { status: 409 });
    }
    // Ordering belongs to this app and works offline for both Jira and local tasks.
    // Status changes go through the normal workflow endpoint before ordering.
    await d1.batch(taskOrderStatements(ids).map(({ sql, params }) => d1.prepare(sql).bind(...params)));
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error, "Unable to save the card order."); }
}
