import { jiraError } from "./jira-fields.mjs";

export const areaNameKey = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const areaOptionId = (value) => value && typeof value === "object" && value.id != null ? String(value.id) : typeof value === "string" && value ? value : null;
export function readAreaCatalog(value) {
  if (!value?.fieldId) return { fieldId: null, name: "Area", projectId: null, options: [], ready: false, message: "Areas are stored on this device until a Jira Area dropdown is configured." };
  if (!/^customfield_\d+$/.test(value.fieldId) || !Array.isArray(value.options)) throw jiraError("Jira returned an invalid Area field.");
  const ids = new Set(), names = new Set();
  const options = value.options.map((option) => {
    const id = String(option.id || ""), name = String(option.name || option.value || "").trim();
    if (!/^\d+$/.test(id) || !name || ids.has(id) || names.has(areaNameKey(name))) throw jiraError("Jira returned duplicate or invalid Area choices.");
    ids.add(id); names.add(areaNameKey(name));
    return { id, name, disabled: Boolean(option.disabled) };
  });
  return { fieldId: value.fieldId, name: String(value.name || "Area"), projectId: String(value.projectId || ""), options, ready: Boolean(value.ready), message: String(value.message || "") };
}
export function findAreaField(fields, projectIds, preferredId) {
  const candidates = fields.filter((field) => (field.id === preferredId || areaNameKey(field.name) === "area") && field.schema?.type === "option" && field.schema?.custom?.endsWith(":select") && (!field.scope?.project?.id || projectIds.includes(String(field.scope.project.id))));
  const scoped = candidates.filter((field) => field.scope?.project?.id);
  const selected = candidates.find((field) => field.id === preferredId) || (scoped.length === 1 ? scoped[0] : candidates.length === 1 ? candidates[0] : null);
  if (!selected && candidates.length > 1) throw jiraError("More than one Jira Area dropdown matches this board. Give the intended field the unique name Area.");
  return selected || null;
}
export function issueAreaGroups(issues) {
  const byKey = new Map(issues.filter((issue) => !issue.syncDeleted).map((issue) => [issue.key, issue]));
  const groups = new Map();
  for (const issue of byKey.values()) {
    let root = issue;
    const path = [], seen = new Map();
    while (root.fields.parent?.key && byKey.has(root.fields.parent.key) && !seen.has(root.key)) {
      seen.set(root.key, path.length); path.push(root); root = byKey.get(root.fields.parent.key);
    }
    if (seen.has(root.key)) root = path.slice(seen.get(root.key)).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))[0];
    const key = root.fields.parent?.key && !byKey.has(root.fields.parent.key) ? `parent:${root.fields.parent.key}` : root.key;
    const group = groups.get(key) || { root, issues: [] }; group.issues.push(issue); groups.set(key, group);
  }
  return [...groups.values()];
}
