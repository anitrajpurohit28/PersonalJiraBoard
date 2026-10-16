import { requestJiraHelper } from "../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

export async function GET() {
  try {
    const result = await requestJiraHelper("queue", "POST");
    if (result.availableOffline) await cacheJiraResult(result);
    return Response.json(result.queue);
  } catch (error) { return errorResponse(error, "Unable to read pending changes."); }
}
export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const payload = await request.json();
    if (!["retry", "discard"].includes(payload.action)) throw new Error("Invalid sync action.");
    const result = await requestJiraHelper(`queue-${payload.action}`, "POST", { id: payload.id, confirm: payload.confirm === true });
    await cacheJiraResult(result);
    return Response.json(result.queue);
  } catch (error) { return errorResponse(error, "The pending change could not be updated."); }
}
