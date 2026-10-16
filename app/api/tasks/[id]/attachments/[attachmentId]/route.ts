import { Buffer } from "node:buffer";
import { jiraTaskKey } from "../../../../../../lib/jira-task-route";
import { requestJiraHelper } from "../../../../../../lib/jira-helper";
import { errorResponse } from "../../../../../../lib/local-request";

export async function GET(_request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const params = await context.params;
    const result = await requestJiraHelper("attachment-content", "POST", { key: await jiraTaskKey(context.params), id: params.attachmentId });
    return new Response(new Uint8Array(Buffer.from(String(result.data), "base64")), { headers: { "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(result.filename))}`, "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "The attachment is not available offline yet."); }
}
