import { jiraTaskKey } from "../../../../../lib/jira-task-route";
import { requestJiraHelper } from "../../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../../../lib/local-request";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const payload = await request.json();
    if (!["comment-add", "comment-edit", "comment-delete", "link-add", "link-delete", "attachment-delete"].includes(payload.action)) throw new Error("Invalid task action.");
    const result = await requestJiraHelper(payload.action, "POST", { ...payload, key: await jiraTaskKey(context.params) });
    await cacheJiraResult(result, { complete: false });
    return Response.json({ ok: true, pending: result.pending });
  } catch (error) { return errorResponse(error, "The change could not be saved."); }
}
