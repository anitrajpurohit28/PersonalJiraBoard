import { ensureTaskSchema } from "../../../../db/tasks";
import { bulkTaskStatements, orderJiraDeletion, parseBulkTaskRequest } from "../../../../lib/bulk-tasks";
import { requestJiraHelper } from "../../../../lib/jira-helper";
import { cacheJiraResult } from "../../../../lib/jira-result";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";

type Row = { id: number; source: string; jira_key: string; jira_parent_key: string | null };
type Success = { key: string };
type Failure = { key: string; error: string };

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const payload = await request.json();
    const selection = parseBulkTaskRequest(payload);
    const d1 = await ensureTaskSchema();
    const rows = (await d1.prepare("SELECT id, source, jira_key, jira_parent_key FROM tasks WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(selection.ids)).all<Row>()).results || [];
    if (rows.length !== selection.ids.length) return Response.json({ error: "The selection changed. Refresh and select the tasks again." }, { status: 409 });
    const selectedJiraRows = rows.filter((row) => row.source === "jira");
    const jiraRows = selection.action === "delete" ? orderJiraDeletion(selectedJiraRows) : selectedJiraRows;
    if (selection.action === "delete" && jiraRows.length && payload.confirmDelete !== true) return Response.json({ error: "Confirm deleting these issues from Jira first." }, { status: 400 });
    const succeededKeys = new Set<string>();
    const failed: Failure[] = [];
    for (let index = 0; index < jiraRows.length; index += 20) {
      const keys = jiraRows.slice(index, index + 20).map((row) => row.jira_key);
      try {
        const result = await requestJiraHelper("bulk", "POST", { action: selection.action, keys, confirmDelete: payload.confirmDelete === true });
        await cacheJiraResult(result, { complete: false });
        for (const success of result.succeeded as Success[]) {
          succeededKeys.add(success.key);
        }
        failed.push(...result.failed as Failure[]);
      } catch (error) { for (const key of keys) if (!succeededKeys.has(key)) failed.push({ key, error: error instanceof Error ? error.message : "Unable to update Jira." }); }
    }
    const succeededIds = rows.filter((row) => row.source !== "jira" || succeededKeys.has(row.jira_key)).map((row) => row.id);
    const localIds = rows.filter((row) => row.source !== "jira").map((row) => row.id);
    if (localIds.length) {
      const statements = bulkTaskStatements(selection.action, localIds, new Date().toISOString());
      await d1.batch(statements.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
    }
    return Response.json({ ok: !failed.length, succeededIds, failed, pending: jiraRows.length > 0 });
  } catch (error) { return errorResponse(error, "Unable to save the bulk action."); }
}
