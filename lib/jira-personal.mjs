import { configuredCloudId, configuredSite } from "../config/settings.mjs";

export function jiraSiteOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) ? url.origin : null;
  } catch { return null; }
}

export function matchesConfiguredSite(site, cloudId) {
  if (configuredSite) return site === configuredSite;
  return Boolean(configuredCloudId && cloudId === configuredCloudId);
}

export function initialTaskStatus(issue) {
  const status = issue.fields?.status;
  if (status?.statusCategory?.key === "done") return "done";
  if (/\b(blocked|waiting|pending|on hold)\b/i.test(status?.name ?? "")) return "waiting";
  if (/\b(review|verification|approval)\b/i.test(status?.name ?? "")) return "confirmation";
  return "now";
}

export function issuePriority(issue) {
  const name = String(issue.fields?.priority?.name ?? "").toLowerCase();
  if (/high|critical|urgent|blocker/.test(name)) return 2;
  if (/low|minor|trivial/.test(name)) return 4;
  return 3;
}
