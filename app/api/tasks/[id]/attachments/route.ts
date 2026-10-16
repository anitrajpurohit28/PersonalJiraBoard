import { Buffer } from "node:buffer";
import { jiraTaskKey } from "../../../../../lib/jira-task-route";
import { requestJiraHelper } from "../../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../../../lib/local-request";
import { MAX_ATTACHMENT_BYTES } from "../../../../../lib/jira-fields.mjs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_ATTACHMENT_BYTES) throw Object.assign(new Error("Choose an attachment up to 25 MB."), { status: 413 });
    const result = await requestJiraHelper("attachment-add", "POST", { key: await jiraTaskKey(context.params), operationId: form.get("operationId"), filename: file.name, mimeType: file.type, data: Buffer.from(await file.arrayBuffer()).toString("base64") });
    await cacheJiraResult(result, { complete: false });
    return Response.json({ ok: true, pending: true });
  } catch (error) { return errorResponse(error, "The attachment could not be saved."); }
}
