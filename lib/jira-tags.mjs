import { jiraError } from "./jira-fields.mjs";

export const emptyTagCatalog = () => ({ version: 1, tags: [], retired: [] });
export function jiraTagLabel(name) {
  return String(name).normalize("NFKC").trim().replace(/\s+/g, "_");
}
export function validJiraLabel(label) {
  return typeof label === "string" && label.length > 0 && label.length <= 255 && !/[\s\u0000-\u001f\u007f]/.test(label);
}
export function cloudTag(value) {
  const name = typeof value?.name === "string" ? value.name.normalize("NFKC").trim() : "";
  const label = value?.label || jiraTagLabel(name);
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(value?.id || "") || !name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name) || !validJiraLabel(label)) throw jiraError("Choose a valid tag name and Jira label.");
  return { id: value.id, name, label };
}
export function readTagCatalog(value) {
  if (value == null) return emptyTagCatalog();
  if (value.version !== 1 || !Array.isArray(value.tags) || !Array.isArray(value.retired || [])) throw jiraError("The Jira tag list has an unsupported format. Its data has been preserved.", 409);
  const catalog = { version: 1, tags: value.tags.map(cloudTag), retired: [...new Set(value.retired || [])] };
  if (catalog.retired.some((label) => !validJiraLabel(label))) throw jiraError("The Jira tag list contains an invalid label.", 409);
  const unique = (field) => new Set(catalog.tags.map((tag) => field === "name" ? tag.name.toLowerCase() : tag[field])).size === catalog.tags.length;
  if (!["id", "name", "label"].every(unique)) throw jiraError("The Jira tag list contains conflicting tag names or labels.", 409);
  return catalog;
}
export function changeTagCatalog(current, change) {
  const result = readTagCatalog(current);
  for (const id of change.remove || []) result.tags = result.tags.filter((tag) => tag.id !== id);
  for (const raw of change.upsert || []) {
    const tag = cloudTag(raw);
    const conflict = result.tags.find((entry) => entry.id !== tag.id && (entry.label === tag.label || entry.name.toLowerCase() === tag.name.toLowerCase()));
    if (conflict) throw jiraError(`The tag “${tag.name}” conflicts with an existing Jira tag. Refresh the tag list before trying again.`, 409);
    result.tags = [...result.tags.filter((entry) => entry.id !== tag.id), tag];
  }
  result.retired = [...new Set([...result.retired, ...(change.retire || [])])].filter((label) => !(change.clearRetired || []).includes(label) && !result.tags.some((tag) => tag.label === label));
  readTagCatalog(result);
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32768) throw jiraError("The tag list exceeds Jira's account-property limit. Reduce the number or length of tag names.");
  return result;
}
export function labelDelta(value) {
  if (!value || !Array.isArray(value.add || []) || !Array.isArray(value.remove || [])) throw jiraError("Invalid tag change.");
  const add = [...new Set(value.add || [])], remove = [...new Set(value.remove || [])];
  if ([...add, ...remove].some((label) => !validJiraLabel(label)) || add.some((label) => remove.includes(label))) throw jiraError("Choose valid Jira labels to add or remove.");
  return { add, remove };
}
export function applyLabelDelta(labels, delta) {
  const change = labelDelta(delta);
  return [...new Set([...(labels || []).filter((label) => !change.remove.includes(label)), ...change.add])];
}
