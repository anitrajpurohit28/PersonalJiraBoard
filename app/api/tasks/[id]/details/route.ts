import { jiraTaskKey } from "../../../../../lib/jira-task-route";
import { requestJiraHelper } from "../../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../../lib/jira-result";
import { errorResponse } from "../../../../../lib/local-request";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = await requestJiraHelper("details", "POST", { key: await jiraTaskKey(context.params) });
    await cacheJiraResult(result, { complete: false });
    return Response.json({ ...result.details as object, offline: !result.connected });
  } catch (error) { return errorResponse(error, "Unable to load the task's activity."); }
}
