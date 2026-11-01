import { initializeJiraAreas } from "../../../../lib/jira-area-sync";
import { ensureTaskSchema } from "../../../../db/tasks";
import { saveArea } from "../../../../db/areas";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try { assertLocalMutation(request); return Response.json(await saveArea(await request.json(), (await context.params).id)); }
  catch (error) { return errorResponse(error, "Unable to save area."); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertLocalMutation(request);
    const { sync } = await initializeJiraAreas();
    if (sync.managed) return Response.json({ error: "Area choices are managed in Jira. Remove the choice in Jira; its tasks remain available." }, { status: 400 });
    const d1 = await ensureTaskSchema();
    await d1.prepare("DELETE FROM personal_areas WHERE id = ?").bind((await context.params).id).run();
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error, "Unable to remove area."); }
}
