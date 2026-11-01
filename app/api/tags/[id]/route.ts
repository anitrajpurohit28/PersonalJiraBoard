import { saveTag, deleteTag } from "../../../../db/tags";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    assertLocalMutation(request);
    return Response.json(await saveTag(await request.json(), (await context.params).id));
  } catch (error) { return errorResponse(error, "Unable to save tag."); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertLocalMutation(request);
    await deleteTag((await context.params).id);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error, "Unable to remove tag."); }
}
