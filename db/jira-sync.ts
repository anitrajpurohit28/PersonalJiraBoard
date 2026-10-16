import { ensureTaskSchema } from "./tasks";
import { planPersonalJiraSync, type JiraIssue, type JiraSyncScope, type SyncOptions } from "../lib/jira-sync-plan";
import { jiraCacheChanges, resolveCachedJiraIssues } from "../lib/jira-cache-changes.mjs";
export type { JiraIssue };

export async function mergePersonalJiraIssues(issues: JiraIssue[], baseUrl: string, accountId: string, scope: JiraSyncScope = { kind: "personal" }, options: SyncOptions = {}) {
  const d1 = await ensureTaskSchema();
  const changes = jiraCacheChanges(options.aliases, options.deletedKeys);
  if (changes.length) await d1.batch(changes.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
  const [removed, aliases] = await Promise.all([
    d1.prepare("SELECT jira_key FROM jira_deleted_tasks").all<{ jira_key: string }>(),
    d1.prepare("SELECT local_key, jira_key FROM jira_task_aliases").all<{ local_key: string; jira_key: string }>(),
  ]);
  issues = resolveCachedJiraIssues(issues, Object.fromEntries(aliases.results.map((row) => [row.local_key, row.jira_key])), removed.results.map((row) => row.jira_key));
  const current = await d1.prepare("SELECT id, jira_key, status, archived, jira_status_category FROM tasks WHERE source = 'jira'")
    .all<{ id: number; jira_key: string; status: string; archived: number; jira_status_category: string | null }>();
  const { statements, ...result } = planPersonalJiraSync(issues, current.results ?? [], baseUrl, accountId, undefined, scope, options);
  if (statements.length) await d1.batch(statements.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
  return { ok: true, ...result };
}
