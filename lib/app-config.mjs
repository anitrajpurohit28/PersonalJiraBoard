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

export function configurationFor(settings) {
  const id = Array.from(JSON.stringify(settings)).reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
  return { configurationId: id, storageNamespace: `personal-${id}` };
}
