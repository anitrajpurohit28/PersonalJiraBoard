import { ensureTaskSchema } from "../db/tasks";
import { mergeJiraTags } from "../db/jira-tags";
import { mergeJiraAreas } from "../db/jira-areas";
import { mergePersonalJiraIssues, type JiraIssue } from "../db/jira-sync";
import { configuredBoardId } from "../config/settings.mjs";
import { jiraSiteOrigin, matchesConfiguredSite } from "./jira-personal.mjs";

export async function cacheJiraResult(payload: Record<string, unknown>, options: { complete?: boolean; createdLocally?: boolean } = {}) {
  const baseUrl = jiraSiteOrigin(payload.baseUrl);
  if (!baseUrl || !matchesConfiguredSite(baseUrl, payload.cloudId) || (payload.boardId ?? null) !== configuredBoardId) throw new Error("Jira returned a different site or board than your configured URL.");
  if (typeof payload.accountId !== "string") throw new Error("Jira returned an incomplete account.");
  const issues = Array.isArray(payload.issues) ? payload.issues : payload.issue ? [payload.issue] : [];
  const scope = configuredBoardId ? { kind: "board" as const, boardId: configuredBoardId } : { kind: "personal" as const };
  const result = await mergePersonalJiraIssues(issues as JiraIssue[], baseUrl, payload.accountId, scope, { ...options, aliases: payload.aliases as Record<string, string> | undefined, deletedKeys: payload.deletedKeys as string[] | undefined, revision: typeof payload.revision === "number" ? payload.revision : undefined, snapshotStartedAt: typeof payload.snapshotStartedAt === "string" ? payload.snapshotStartedAt : undefined });
  if (payload.tagsMigrated === true && payload.tagCatalog) await mergeJiraTags(await ensureTaskSchema(), payload.tagCatalog, Number(payload.revision || 0));
  if (payload.areasMigrated === true && payload.areaCatalog) await mergeJiraAreas(await ensureTaskSchema(), payload.areaCatalog, issues as Array<{ key: string; fields: Record<string, unknown> }>, Number(payload.revision || 0));
  return result;
}
