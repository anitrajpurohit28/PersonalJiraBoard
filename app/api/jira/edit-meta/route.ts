import { requestJiraHelper } from "../../../../lib/jira-helper";
import { errorResponse } from "../../../../lib/local-request";

export async function GET(request: Request) {
  try { return Response.json(await requestJiraHelper("edit-meta", "POST", { key: new URL(request.url).searchParams.get("key") })); }
  catch (error) { return errorResponse(error, "Unable to load Jira task details."); }
}
