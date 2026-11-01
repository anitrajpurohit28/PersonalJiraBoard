import { ensureTaskSchema } from "../db/tasks";
import { tagSeed } from "../db/jira-tags";
import { requestJiraHelper } from "./jira-helper";
import { cacheJiraResult } from "./jira-result";

export async function initializeJiraTags() {
  const d1 = await ensureTaskSchema();
  const result = await requestJiraHelper("tags-init", "POST", await tagSeed(d1));
  await cacheJiraResult(result);
  return d1;
}
export async function changeJiraTags(action: "tags-upsert" | "tags-delete" | "tags-assign", payload: unknown) {
  const result = await requestJiraHelper(action, "POST", payload);
  await cacheJiraResult(result);
  return result;
}
