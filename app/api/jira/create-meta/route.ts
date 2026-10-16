import { requestJiraHelper } from "../../../../lib/jira-helper";
import { errorResponse } from "../../../../lib/local-request";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    return Response.json(await requestJiraHelper("create-meta", "POST", { projectId: query.get("projectId"), issueTypeId: query.get("issueTypeId"), parentKey: query.get("parentKey") }));
  } catch (error) { return errorResponse(error, "Unable to load Jira creation fields."); }
}
