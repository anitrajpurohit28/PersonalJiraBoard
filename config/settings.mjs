import rawSettings from "./app.json" with { type: "json" };

export function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config/app.json must contain email and jiraUrl.");
  if (Object.keys(value).some((key) => !["email", "jiraUrl"].includes(key))) throw new Error("config/app.json only needs email and jiraUrl.");
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("config/app.json: enter your email address.");
  let url;
  try { url = new URL(value.jiraUrl); } catch { throw new Error("config/app.json: enter a valid Jira URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(/^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) || url.hostname === "home.atlassian.com")) {
    throw new Error("config/app.json: use your HTTPS Atlassian Home or Jira Cloud URL.");
  }
  if (url.hostname === "home.atlassian.com" && !url.searchParams.get("cloudId")) throw new Error("config/app.json: use the Atlassian Home link containing cloudId, or your Jira site URL.");
  return { email, jiraUrl: url.href };
}

export const settings = validateSettings(rawSettings);
const fingerprint = (value) => Array.from(value).reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
export const configurationId = fingerprint(JSON.stringify(settings));
export const storageNamespace = `personal-${configurationId}`;
export const configuredUrl = new URL(settings.jiraUrl);
export const configuredCloudId = configuredUrl.searchParams.get("cloudId");
export const configuredSite = configuredUrl.hostname.endsWith(".atlassian.net") ? configuredUrl.origin : null;
export const configuredBoardId = configuredUrl.pathname.match(/\/boards\/(\d+)/)?.[1] ?? configuredUrl.searchParams.get("rapidView");
export const localSettings = Object.freeze({ helperHost: "127.0.0.1", helperPort: 4327, browserPort: 3100, desktopPort: 3120 });
export const helperBaseUrl = `http://${localSettings.helperHost}:${localSettings.helperPort}`;
export const appProtocolVersion = 17;
export const helperProtocolVersion = 14;
