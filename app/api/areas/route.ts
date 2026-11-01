import { initializeJiraAreas, cachedAreaSync } from "../../../lib/jira-area-sync";
import { listAreas, saveArea } from "../../../db/areas";
import { assertLocalMutation, errorResponse } from "../../../lib/local-request";

export async function GET() {
  try {
    const sync = await initializeJiraAreas().then((state) => state.sync).catch(() => cachedAreaSync());
    return Response.json({ areas: await listAreas(), sync });
  }
  catch (error) { return errorResponse(error, "Unable to load areas."); }
}
export async function POST(request: Request) {
  try { assertLocalMutation(request); return Response.json(await saveArea(await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error, "Unable to create area."); }
}
