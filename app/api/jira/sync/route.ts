import { requestJiraHelper } from "../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const options = await request.json().catch(() => ({}));
    const payload = await requestJiraHelper("issues", "POST", { refresh: options.refresh === true });
    if (!Array.isArray(payload.issues)) throw new Error("Jira returned an incomplete result.");
    return Response.json({ ...await cacheJiraResult(payload), connected: payload.connected, queue: payload.queue });
  } catch (error) { return errorResponse(error, "Unable to sync Jira."); }
}
