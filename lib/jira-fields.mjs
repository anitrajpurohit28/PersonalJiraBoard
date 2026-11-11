import { parseDescriptionChecklist } from "./description-checklist.mjs";
import { textLinks } from "./text-links.mjs";

export const CORE_JIRA_FIELDS = ["summary", "description", "priority", "duedate", "parent", "labels"];
export const jiraError = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
export const validIssueKey = (value) => typeof value === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(value);
export const validLocalKey = (value) => typeof value === "string" && /^local:[a-f0-9-]{36}$/i.test(value);
export const validTaskKey = (value) => validIssueKey(value) || validLocalKey(value);
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export function jiraPriorityButtons(allowedValues, value) {
  const priorities = allowedValues.map((option) => typeof option === "object" ? { id: String(option.id || option.value), name: String(option.name || option.value || "") } : { id: option, name: option });
  const options = ["High", "Medium", "Low"].flatMap((name) => {
    const option = priorities.find((option) => option.name.toLowerCase() === name.toLowerCase());
    return option ? [{ id: option.id, name }] : [];
  });
  const id = String(typeof value === "object" && value ? value.id || value.value : value ?? "");
  const current = priorities.find((option) => option.id === id);
  // Show legacy Jira extremes in the nearest category without changing the issue.
  const name = current?.name.replace(/^Highest$/i, "High").replace(/^Lowest$/i, "Low");
  return { options, value: options.find((option) => option.id === id || option.name.toLowerCase() === name?.toLowerCase())?.id || id };
}
export function toAdf(text, { checklist = false } = {}) {
  const rows = checklist ? parseDescriptionChecklist(text) : null;
  return { type: "doc", version: 1, content: String(text).split(/\r?\n/).map((line, index) => ({ type: "paragraph", content: textLinks(line).map((part) => {
    const marks = [...(part.href ? [{ type: "link", attrs: { href: part.href } }] : []), ...(rows?.[index]?.done ? [{ type: "strike" }] : [])];
    return { type: "text", text: part.text, ...(marks.length ? { marks } : {}) };
  }) })) };
}
export function adfText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const text = (node.content || []).map(adfText).join("");
  return ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(node.type) ? `${text}\n` : text;
}
export function normalizedDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
export function jiraDateMigrations(rows) {
  return rows.map((row) => ({ id: row.id, previous: row.jira_updated_at, updatedAt: normalizedDate(row.jira_updated_at), createdAt: normalizedDate(row.jira_created_at) }))
    .filter((row, index) => row.updatedAt !== rows[index].jira_updated_at || row.createdAt !== rows[index].jira_created_at);
}
const empty = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);

export function publicFields(fields) {
  return (Array.isArray(fields) ? fields : Object.entries(fields || {}).map(([fieldId, field]) => ({ ...field, fieldId }))).map((field) => ({
    fieldId: field.fieldId || field.key, name: field.name || field.fieldId || field.key,
    required: Boolean(field.required), hasDefaultValue: Boolean(field.hasDefaultValue),
    schema: field.schema || { type: "string" }, allowedValues: field.allowedValues || [],
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
  })).filter((field) => field.fieldId);
}

function option(value, allowed, name) {
  const id = typeof value === "object" ? value?.id ?? value?.value : value;
  const found = allowed.find((entry) => String(typeof entry === "object" ? entry.id ?? entry.value : entry) === String(id));
  if (!found) throw jiraError(`Choose a valid ${name}.`);
  if (typeof found !== "object") return found;
  const selected = found.id !== undefined ? { id: String(found.id) } : { value: String(found.value) };
  if (value?.child && found.children?.length) selected.child = option(value.child, found.children, name);
  return selected;
}

export function fieldValue(field, raw, accountId) {
  const { schema = {}, allowedValues = [], name, fieldId } = field;
  if (fieldId === "labels" && Array.isArray(raw) && !raw.length) return [];
  if (empty(raw)) return null;
  if (schema.type === "array") {
    if (!Array.isArray(raw)) throw jiraError(`${name} must be a list.`);
    return raw.map((value) => allowedValues.length ? option(value, allowedValues, name) : schema.items === "string" ? String(value).trim() : value);
  }
  if (schema.type === "user" || ["assignee", "reporter"].includes(fieldId)) {
    const id = typeof raw === "object" ? raw.accountId : raw;
    if (id !== accountId) throw jiraError(`For this personal board, ${name} must be you or unassigned.`);
    return { accountId };
  }
  if (allowedValues.length) return option(raw, allowedValues, name);
  if (schema.type === "number" || schema.type === "integer") {
    const number = Number(raw);
    if (!Number.isFinite(number) || (schema.type === "integer" && !Number.isInteger(number))) throw jiraError(`${name} must be a valid number.`);
    return number;
  }
  if (schema.type === "date" || fieldId === "duedate") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !normalizedDate(raw) || normalizedDate(raw).slice(0, 10) !== raw) throw jiraError(`${name} must be a valid date.`);
    return raw;
  }
  if (schema.type === "datetime") {
    if (!normalizedDate(raw)) throw jiraError(`${name} must be a valid date and time.`);
    return normalizedDate(raw);
  }
  if (schema.type === "boolean") {
    if (typeof raw !== "boolean") throw jiraError(`${name} must be true or false.`);
    return raw;
  }
  if (fieldId === "parent") {
    const key = typeof raw === "object" ? raw.key : raw;
    if (!validTaskKey(key)) throw jiraError("Choose a parent task or enter its Jira key.");
    return { key };
  }
  if (["description", "environment"].includes(fieldId) || schema.custom?.endsWith(":textarea")) {
    if (typeof raw !== "string" || raw.length > 32000) throw jiraError(`${name} must contain at most 32,000 characters.`);
    return toAdf(raw, { checklist: fieldId === "description" });
  }
  if (schema.type === "string" || !schema.type) {
    if (typeof raw !== "string") throw jiraError(`${name} must be text.`);
    const text = raw.trim();
    if (text.length > (fieldId === "summary" ? 255 : 32000)) throw jiraError(`${name} is too long.`);
    return text;
  }
  if (schema.type === "option" && typeof raw === "object" && raw.id) return { id: String(raw.id) };
  throw jiraError(`${name} needs a field type this app cannot edit. Open this issue in Jira to set it.`);
}

export function prepareFields(metadata, input, accountId, { creating = false, subtask = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw jiraError("Jira fields are required.");
  const byId = new Map(metadata.map((field) => [field.fieldId, field]));
  const result = {};
  for (const [id, raw] of Object.entries(input)) {
    if (["project", "issuetype"].includes(id)) throw jiraError("Choose the project and issue type using the supplied options.");
    const field = byId.get(id);
    if (!field) throw jiraError(`Jira does not allow editing ${id} for this issue type.`);
    if (empty(raw) && field.required && !field.hasDefaultValue) throw jiraError(`${field.name} is required by Jira.`);
    result[id] = fieldValue(field, raw, accountId);
  }
  if (creating) {
    for (const field of metadata) {
      if (["project", "issuetype"].includes(field.fieldId)) continue;
      if (field.required && !field.hasDefaultValue && empty(result[field.fieldId])) throw jiraError(`${field.name} is required by Jira.`);
    }
    if (!result.summary) throw jiraError("Summary is required.");
    if (subtask && !result.parent) throw jiraError("A parent issue is required for a subtask.");
  }
  return result;
}

// Jira priority IDs vary by site and issue type; only use allowed IDs.
export function inheritedPriority(allowedValues, parentPriority) {
  const id = typeof parentPriority === "object" ? parentPriority?.id : parentPriority;
  const name = typeof parentPriority === "object" ? parentPriority?.name : undefined;
  const priorities = allowedValues.map((entry) => typeof entry === "object" ? entry : { id: entry, name: entry });
  const match = priorities.find((entry) => id && String(entry.id || entry.value) === String(id))
    || priorities.find((entry) => name && String(entry.name || entry.value).toLowerCase() === name.toLowerCase());
  return match ? String(match.id || match.value) : undefined;
}

export function personalFields(metadata, input = {}, accountId, options = {}) {
  const values = { ...input };
  delete values.assignee;
  if (metadata.some((field) => field.fieldId === "assignee")) values.assignee = accountId;
  const reporter = metadata.find((field) => field.fieldId === "reporter");
  if (reporter?.required && !reporter.hasDefaultValue) values.reporter = accountId;
  const priority = metadata.find((field) => field.fieldId === "priority");
  if (options.creating && priority && empty(values.priority)) {
    const medium = priority.allowedValues.find((value) => /^medium$/i.test(value?.name || value?.value || ""));
    values.priority = inheritedPriority(priority.allowedValues, options.parentPriority) || (medium ? String(medium.id || medium.value) : undefined);
    if (values.priority === undefined) delete values.priority;
  }
  if (options.creating && options.subtask && values.labels === undefined && Array.isArray(options.parentLabels) && metadata.some((field) => field.fieldId === "labels")) {
    values.labels = [...options.parentLabels];
  }
  return { input: values, fields: prepareFields(metadata, values, accountId, options) };
}

export function comparableField(id, value) {
  if (["description", "environment"].includes(id)) return adfText(value).trimEnd();
  if (id === "parent") return value?.key || value || null;
  if (id === "assignee" || id === "reporter") return value?.accountId || value || null;
  if (id === "labels") return [...(value || [])].sort();
  if (value && typeof value === "object" && !Array.isArray(value) && value.id !== undefined) return String(value.id);
  return value ?? null;
}
