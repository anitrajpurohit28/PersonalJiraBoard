import { requestJiraHelper } from "../../../lib/jira-helper";
import { assertLocalMutation, errorResponse } from "../../../lib/local-request";
export async function GET() {
  try { return Response.json(await requestJiraHelper("app-update-status")); }
  catch (error) { return errorResponse(error, "Unable to check the updater."); }
}
export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const { action, version } = await request.json();
    if (!["check", "prepare"].includes(action)) return Response.json({ error: "Invalid update action." }, { status: 400 });
    return Response.json(await requestJiraHelper(`app-update-${action}`, "POST", { version }));
  } catch (error) { return errorResponse(error, "Unable to update. Your tasks are unchanged."); }
}
