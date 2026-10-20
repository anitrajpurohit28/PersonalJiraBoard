import { moveToArea } from "../../../../db/areas";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

export async function PUT(request: Request) {
  try {
    assertLocalMutation(request);
    const payload = await request.json();
    return Response.json(await moveToArea(payload.ids, payload.areaId));
  } catch (error) { return errorResponse(error, "Unable to move tasks to this area."); }
}
