import { requestJiraHelper } from "../../../../lib/jira-helper";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

export async function GET() {
  try { return Response.json(await requestJiraHelper("status")); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to check Jira." }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const { action, apiToken, remember } = await request.json();
    if (!["connect", "disconnect"].includes(action)) return Response.json({ error: "Invalid action." }, { status: 400 });
    return Response.json(await requestJiraHelper(action, "POST", action === "connect" ? { apiToken, remember } : undefined));
  } catch (error) { return errorResponse(error, "Unable to connect Jira."); }
}
