import { JiraApi } from "../local/jira-api.mjs";
import { JiraWorkspace } from "../local/jira-workspace.mjs";
import { settings, configuredSite } from "../config/settings.mjs";

export const accountId = "anit-account";
export const identity = { accountId, emailAddress: settings.email, displayName: "Anit" };
export const statuses = [
  { id: "10", name: "To Do", statusCategory: { key: "new" } },
  { id: "20", name: "In Progress", statusCategory: { key: "indeterminate" } },
  { id: "30", name: "Done", statusCategory: { key: "done" } },
];
const priorities = [{ id: "2", name: "High" }, { id: "3", name: "Medium" }];
const linkTypes = [{ id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" }];
export const issue = (key = "KAN-1", category = "indeterminate") => ({ id: key, key, fields: {
  summary: key === "KAN-1" ? "Task 1" : "Task 2", description: null,
  status: structuredClone(statuses.find((status) => status.statusCategory.key === category)),
  assignee: null, reporter: { accountId: "sample-creator" }, priority: { id: "3", name: "Medium" },
  project: { id: "10001", key: "KAN" }, issuetype: { id: "task", name: "Task", subtask: false },
  created: "2026-10-15T09:00:00Z", updated: "2026-10-15T10:00:00Z", labels: [], subtasks: [], attachment: [], issuelinks: [],
} });
const field = (fieldId, type, extra = {}) => ({ fieldId, name: fieldId, required: false, hasDefaultValue: false, schema: { type }, ...extra });
export const baseFields = [
  field("project", "project", { required: true }), field("issuetype", "issuetype", { required: true }),
  field("summary", "string", { required: true }), field("description", "string"), field("duedate", "date"),
  field("assignee", "user"), field("labels", "array", { schema: { type: "array", items: "string" } }),
  field("priority", "priority", { hasDefaultValue: true, allowedValues: priorities }),
];

export function jiraFixture() {
  const issues = new Map([issue(), issue("KAN-2")].map((issue) => [issue.key, issue]));
  const calls = [], receipts = new Map(), faults = new Map(), afterFaults = new Map(), excluded = new Set();
  const properties = new Map();
  const comments = new Map(), files = new Map(), blobs = new Map();
  let ticks = 0, nextKey = 10, nextItem = 100, savedState = null;
  const state = { identity: { ...identity }, extraFields: [], transitionFields: {}, gatewayOnly: false, offline: false, pause: null, areaField: false, areaOnTask: true, areaOnSubtask: true, areaOptions: [{ id: "201", value: "Work" }, { id: "202", value: "Personal" }, { id: "203", value: "Learn" }] };
  const store = {
    readState: async () => structuredClone(savedState),
    writeState: async (value) => { savedState = structuredClone(value); },
    writeBlob: async (key, value) => { blobs.set(key, Buffer.from(value)); },
    readBlob: async (key) => blobs.has(key) ? Buffer.from(blobs.get(key)) : null,
    deleteBlob: async (key) => { blobs.delete(key); },
  };
  const reply = (value, status = 200) => status === 204 ? new Response(null, { status }) : Response.json(structuredClone(value), { status });
  const updated = () => new Date(Date.parse("2026-10-15T11:00:00Z") + (++ticks) * 1000).toISOString();
  const areaFieldId = "customfield_123";
  const areaFields = (subtask) => state.areaField && (subtask ? state.areaOnSubtask : state.areaOnTask) ? [field(areaFieldId, "option", { name: "Area", schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" }, allowedValues: state.areaOptions })] : [];
  const fillArea = (fields) => {
    if (!state.areaField) return;
    const raw = fields[areaFieldId];
    fields[areaFieldId] = raw ? structuredClone(state.areaOptions.find((option) => option.id === raw.id) || raw) : null;
  };
  const fetchImpl = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl), path = url.pathname.replace(/^\/ex\/jira\/[^/]+/, ""), method = init.method || "GET";
    const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(init.body) : null;
    calls.push({ url, path, method, body, headers: init.headers });
    if (state.offline) throw new Error("Offline");
    if (state.pause) await state.pause({ path, method });
    if (path === "/_edge/tenant_info") return reply({ cloudId: "48423c1c-da4f-4bac-8c49-7b42dc6fce44" });
    if (state.gatewayOnly && url.hostname !== "api.atlassian.com") return reply({}, 401);
    const fault = faults.get(`${method} ${path}`);
    if (fault) { if (fault instanceof Error) throw fault; return reply(fault.payload || { errorMessages: ["Rejected by Jira"] }, fault.status); }
    const finish = (value, status = 200) => { if (afterFaults.delete(`${method} ${path}`)) throw new Error("Response lost after save"); return reply(value, status); };
    if (path.startsWith("/rest/api/3/user/properties/")) {
      const key = path.split("/").at(-1);
      if (url.searchParams.get("accountId") !== accountId) return reply({}, 403);
      if (method === "PUT") { properties.set(key, structuredClone(body)); return finish(null, 201); }
      return properties.has(key) ? reply({ key, value: properties.get(key) }) : reply({}, 404);
    }
    if (path === "/rest/api/3/myself") return reply(state.identity);
    if (path === "/rest/api/3/serverInfo") return reply({ baseUrl: configuredSite });
    if (path === "/rest/api/3/field") return reply(state.areaField ? [{ id: areaFieldId, name: "Area", custom: true, scope: { type: "PROJECT", project: { id: "10001" } }, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" } }] : []);
    if (path === "/rest/api/3/status") return reply(statuses);
    if (path === "/rest/api/3/priority") return reply(priorities);
    if (path === "/rest/api/3/issueLinkType") return reply({ issueLinkTypes: linkTypes });
    if (path === "/rest/api/3/attachment/meta") return reply({ enabled: true, uploadLimit: 25 * 1024 * 1024 });
    if (path === "/rest/agile/1.0/board/2") return reply({ id: 2, name: "Anit Personal Board", location: { projectId: "10001" } });
    if (path === "/rest/agile/1.0/board/2/configuration") return reply({ columnConfig: { columns: statuses.map((status) => ({ name: status.name, statuses: [{ id: status.id }] })) } });
    if (path === "/rest/agile/1.0/board/2/project") return reply({ values: [{ id: "10001", key: "KAN", name: "Personal" }], isLast: true });
    if (/\/issue\/createmeta\/10001\/issuetypes$/.test(path)) return reply({ issueTypes: [{ id: "epic", name: "Epic", subtask: false }, { id: "task", name: "Task", subtask: false }, { id: "subtask", name: "Subtask", subtask: true }], isLast: true });
    if (/\/issue\/createmeta\/10001\/issuetypes\//.test(path)) return reply({ fields: [...baseFields, ...state.extraFields, ...areaFields(path.endsWith("/subtask")), ...(path.endsWith("/subtask") ? [field("parent", "issuelink", { required: true })] : [])].filter((entry) => !state.omitCreateLabels || entry.fieldId !== "labels"), isLast: true });
    if (/^\/rest\/(software|agile)\/1\.0\/board\/2\/issue$/.test(path) || path === "/rest/api/3/search/jql") {
      const keys = [...(url.searchParams.get("jql") || "").matchAll(/"([A-Z][A-Z0-9_]*-\d+)"/g)].map((match) => match[1]);
      if (state.areaField) for (const item of issues.values()) fillArea(item.fields);
      return reply({ issues: [...issues.values()].filter((issue) => !excluded.has(issue.key) && (!keys.length || keys.includes(issue.key))), isLast: true });
    }
    if (path === "/rest/api/3/issue" && method === "POST") {
      const key = `KAN-${++nextKey}`, created = issue(key, "new");
      Object.assign(created.fields, body.fields, { project: { id: "10001", key: "KAN" }, reporter: { accountId }, updated: updated() });
      created.fields.priority = priorities.find((p) => p.id === body.fields.priority?.id) || created.fields.priority;
      created.fields.issuetype = { id: body.fields.issuetype.id, name: body.fields.issuetype.id === "subtask" ? "Subtask" : "Task", subtask: body.fields.issuetype.id === "subtask" };
      created.properties = Object.fromEntries((body.properties || []).map(({ key, value }) => [key, value]));
      fillArea(created.fields);
      issues.set(key, created);
      if (created.fields.parent) issues.get(created.fields.parent.key)?.fields.subtasks.push({ key });
      return finish({ key, id: key }, 201);
    }
    let match = path.match(/^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-\d+)\/properties\/(.+)$/);
    if (match) { const value = issues.get(match[1])?.properties?.[match[2]]; return value ? reply({ value }) : reply({}, 404); }
    match = path.match(/^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-\d+)\/comment(?:\/(\d+))?$/);
    if (match) {
      if (!issues.has(match[1])) return reply({}, 404);
      const list = comments.get(match[1]) || []; comments.set(match[1], list);
      const current = list.find((comment) => comment.id === match[2]);
      if (!match[2] && method === "GET") return reply({ comments: list, total: list.length });
      if (method === "POST") { const comment = { id: String(++nextItem), body: body.body, properties: body.properties, author: identity, created: updated(), updated: updated() }; list.push(comment); return finish(comment, 201); }
      if (!current) return reply({}, 404);
      if (method === "PUT") { current.body = body.body; current.updated = updated(); return finish(current); }
      if (method === "DELETE") { list.splice(list.indexOf(current), 1); return finish(null, 204); }
      return reply(current);
    }
    match = path.match(/^\/rest\/api\/3\/comment\/(\d+)\/properties\/(.+)$/);
    if (match) { const value = [...comments.values()].flat().find((c) => c.id === match[1])?.properties?.find((p) => p.key === match[2])?.value; return value ? reply({ value }) : reply({}, 404); }
    if (path === "/rest/api/3/issueLink" && method === "POST") {
      const from = issues.get(body.inwardIssue.key), to = issues.get(body.outwardIssue.key);
      if (!from || !to) return reply({}, 404);
      if (!from.fields.issuelinks.some((l) => l.outwardIssue?.key === to.key && l.type.id === body.type.id)) {
        const id = String(++nextItem), type = linkTypes.find((t) => t.id === body.type.id);
        from.fields.issuelinks.push({ id, type, outwardIssue: { key: to.key, fields: { summary: to.fields.summary } } });
        to.fields.issuelinks.push({ id, type, inwardIssue: { key: from.key, fields: { summary: from.fields.summary } } });
      }
      if (afterFaults.delete(`${method} ${path}`)) throw new Error("Response lost after save");
      return new Response(null, { status: 201 });
    }
    match = path.match(/^\/rest\/api\/3\/issueLink\/(\d+)$/);
    if (match && method === "DELETE") { for (const task of issues.values()) task.fields.issuelinks = task.fields.issuelinks.filter((l) => l.id !== match[1]); return finish(null, 204); }
    match = path.match(/^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-\d+)\/attachments$/);
    if (match && method === "POST") {
      const file = body.get("file"), id = String(++nextItem);
      files.set(id, Buffer.from(await file.arrayBuffer()));
      const attachment = { id, filename: file.name, mimeType: file.type, size: file.size, author: identity };
      issues.get(match[1]).fields.attachment.push(attachment); return finish([attachment]);
    }
    match = path.match(/^\/rest\/api\/3\/attachment\/content\/(\d+)$/);
    if (match) return files.has(match[1]) ? new Response(files.get(match[1])) : reply({}, 404);
    match = path.match(/^\/rest\/api\/3\/attachment\/(\d+)$/);
    if (match && method === "DELETE") { files.delete(match[1]); for (const task of issues.values()) task.fields.attachment = task.fields.attachment.filter((f) => f.id !== match[1]); return finish(null, 204); }
    match = path.match(/^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-\d+)(?:\/(editmeta|transitions|assignee))?$/);
    if (match) {
      const current = issues.get(match[1]);
      if (!current) return reply({ errorMessages: ["Issue missing"] }, 404);
      if (match[2] === "editmeta") return reply({ fields: Object.fromEntries([...baseFields, ...state.extraFields, ...areaFields(current.fields.issuetype.subtask)].map((field) => [field.fieldId, field])) });
      if (match[2] === "assignee") { current.fields.assignee = body; return finish(null, 204); }
      if (match[2] === "transitions") {
        if (method === "GET") return reply({ transitions: statuses.map((status) => ({ id: `to-${status.id}`, name: status.name, to: status, fields: state.transitionFields })) });
        current.fields.status = structuredClone(statuses.find((status) => `to-${status.id}` === body.transition.id));
        current.fields.updated = updated(); return finish(null, 204);
      }
      if (method === "PUT") { for (const change of body.update?.labels || []) { if (change.add && !current.fields.labels.includes(change.add)) current.fields.labels.push(change.add); if (change.remove) current.fields.labels = current.fields.labels.filter((label) => label !== change.remove); } Object.assign(current.fields, body.fields); fillArea(current.fields); if (body.fields?.priority) current.fields.priority = priorities.find((p) => p.id === body.fields.priority.id); current.fields.updated = updated(); return finish(null, 204); }
      if (method === "DELETE") {
        if ((current.fields.subtasks || []).some((child) => issues.has(child.key))) return reply({ errorMessages: ["Delete subtasks first"] }, 400);
        issues.delete(current.key); return finish(null, 204);
      }
      fillArea(current.fields);
      return reply(current);
    }
    throw new Error(`Unexpected Jira request: ${method} ${path}`);
  };
  const makeClient = () => new JiraApi("fake-test-token", { fetchImpl, readReceipt: async (id) => receipts.get(id), writeReceipt: async (id, value) => { receipts.set(id, structuredClone(value)); } });
  const makeWorkspace = () => new JiraWorkspace({ store });
  return { issues, calls, receipts, faults, afterFaults, excluded, state, fetchImpl, makeClient, makeWorkspace, store, blobs, comments, files, properties };
}
