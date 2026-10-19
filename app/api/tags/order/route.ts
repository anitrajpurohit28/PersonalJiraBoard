import { ensureTaskSchema } from "../../../../db/tasks";
import { listTags } from "../../../../db/tags";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";
import { parseTagOrder, tagOrderStatements } from "../../../../lib/task-tags";

export async function PUT(request: Request) {
  try {
    assertLocalMutation(request);
    const d1 = await ensureTaskSchema();
    const current = await listTags(d1);
    const ids = parseTagOrder(await request.json(), current.map((tag) => tag.id));
    const statements = tagOrderStatements(ids);
    if (statements.length) await d1.batch(statements.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
    return Response.json({ tags: await listTags(d1) });
  } catch (error) { return errorResponse(error, "Unable to save tag order."); }
}
