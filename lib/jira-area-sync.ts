import { ensureTaskSchema } from "../db/tasks";
import { areaSeed } from "../db/jira-areas";
import { requestJiraHelper } from "./jira-helper";
import { cacheJiraResult } from "./jira-result";
import { readAreaCatalog } from "./jira-areas.mjs";
import type { AreaSyncInfo } from "./task-areas";

export async function initializeJiraAreas() {
  const d1 = await ensureTaskSchema();
  const result = await requestJiraHelper("areas-init", "POST", await areaSeed(d1));
  await cacheJiraResult(result);
  const catalog = readAreaCatalog(result.areaCatalog);
  return { d1, result, sync: { managed: Boolean(catalog.fieldId), ready: catalog.ready && result.areasMigrated === true, message: catalog.message } as AreaSyncInfo };
}
export async function cachedAreaSync(): Promise<AreaSyncInfo> {
  const d1 = await ensureTaskSchema();
  const row = await d1.prepare("SELECT field_id FROM jira_area_sync_state WHERE id = 1").first<{ field_id: string | null }>();
  return { managed: Boolean(row?.field_id), ready: Boolean(row?.field_id), message: row?.field_id ? "Area choices sync from Jira. Offline moves sync after reconnecting." : "Areas are stored on this device." };
}
