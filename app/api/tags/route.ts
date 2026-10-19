import { listTags, saveTag } from "../../../db/tags";
import { assertLocalMutation, errorResponse } from "../../../lib/local-request";

export async function GET() {
  try { return Response.json({ tags: await listTags() }); }
  catch (error) { return errorResponse(error, "Unable to load tags."); }
}
export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    return Response.json(await saveTag(await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error, "Unable to create tag."); }
}
