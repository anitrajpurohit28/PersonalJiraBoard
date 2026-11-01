import { ensureTaskSchema } from "./tasks";
import { jiraTagLabel } from "../lib/jira-tags.mjs";

import { tagCacheStatements, type StoredTag } from "../lib/jira-tag-cache";
export type { StoredTag };
export async function storedTags(d1: Awaited<ReturnType<typeof ensureTaskSchema>>) {
  return (await d1.prepare("SELECT * FROM personal_tags ORDER BY sort_order, name_key, id").all<StoredTag>()).results;
}
export async function tagSeed(d1: Awaited<ReturnType<typeof ensureTaskSchema>>) {
  const tags = await storedTags(d1);
  const assigned = (await d1.prepare("SELECT tasks.jira_key, assigned.tag_id FROM personal_task_tags assigned JOIN tasks ON tasks.id = assigned.task_id WHERE tasks.source = 'jira'").all<{ jira_key: string; tag_id: string }>()).results;
  const assignments = new Map<string, string[]>();
  for (const row of assigned) {
    const tag = tags.find((tag) => tag.id === row.tag_id);
    if (tag) assignments.set(row.jira_key, [...(assignments.get(row.jira_key) || []), tag.jira_tag_id || tag.id]);
  }
  return { tags: tags.map((tag) => ({ id: tag.jira_tag_id || tag.id, name: tag.name, label: tag.jira_label || jiraTagLabel(tag.name) })), assignments: [...assignments].map(([key, tagIds]) => ({ key, tagIds })) };
}
export async function mergeJiraTags(d1: Awaited<ReturnType<typeof ensureTaskSchema>>, value: unknown, revision: number) {
  const statements = tagCacheStatements(await storedTags(d1), value, revision);
  await d1.batch(statements.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
}
