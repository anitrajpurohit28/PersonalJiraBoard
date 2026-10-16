import { configurationId, helperBaseUrl, helperProtocolVersion, settings } from "../config/settings.mjs";

export async function requestJiraHelper(path: string, method = "GET", body?: unknown) {
  let response;
  try { response = await fetch(`${helperBaseUrl}/api/jira/${path}`, { method, signal: AbortSignal.timeout(180000), headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error("The local Jira connection is unavailable. Restart the app."); }
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(String(payload.error || "Unable to reach Jira.")), { status: response.status, uncertain: payload.uncertain });
  if (payload.configId !== configurationId || Number(payload.protocolVersion) !== helperProtocolVersion) throw new Error("The local Jira service uses different settings or an older version. Restart the app.");
  if (path === "issues" && payload.connected !== true && payload.availableOffline !== true) throw new Error("Connect Jira once to cache your board.");
  if ((payload.connected || payload.availableOffline) && String(payload.account).toLowerCase() !== settings.email) throw new Error(`Only ${settings.email} can connect to this app.`);
  return payload;
}
