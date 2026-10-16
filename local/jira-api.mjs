import { createHash } from "node:crypto";
import { settings, configuredSite, configuredCloudId, configuredBoardId } from "../config/settings.mjs";
import { readJiraIssues, verifyIdentity, ISSUE_FIELDS } from "../lib/jira-reader.mjs";
import { jiraSiteOrigin } from "../lib/jira-personal.mjs";
import { jiraError, validIssueKey, normalizedDate, publicFields, personalFields, toAdf, MAX_ATTACHMENT_BYTES } from "../lib/jira-fields.mjs";
import { readCreateReceipt, writeCreateReceipt } from "./jira-credentials.mjs";

const canonical = (value) => value && typeof value === "object" ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const OPERATION_PROPERTY = "personal-jira-board.operation";

export async function jiraPages(request, path, property = "values") {
  const values = [];
  let startAt = 0;
  for (let page = 0; page < 100; page++) {
    const result = await request(`${path}${path.includes("?") ? "&" : "?"}startAt=${startAt}&maxResults=100`);
    const entries = result[property] ?? result.values ?? result.results;
    if (!Array.isArray(entries)) throw jiraError("Jira returned incomplete field options.", 502);
    values.push(...entries);
    startAt += entries.length;
    if (result.isLast === true || (Number.isFinite(result.total) && startAt >= result.total) || (result.isLast === undefined && !Number.isFinite(result.total) && entries.length < 100)) return values;
    if (!entries.length) break;
  }
  throw jiraError("Jira returned incomplete field options. Try again.", 502);
}

export class JiraApi {
  constructor(token, { fetchImpl = globalThis.fetch, readReceipt = readCreateReceipt, writeReceipt = writeCreateReceipt, configuration = { email: settings.email, jiraUrl: settings.jiraUrl, site: configuredSite, cloudId: configuredCloudId, boardId: configuredBoardId } } = {}) {
    this.configuration = configuration;
    this.fetch = fetchImpl;
    this.readReceipt = readReceipt;
    this.writeReceipt = writeReceipt;
    this.authorization = `Basic ${Buffer.from(`${configuration.email}:${token}`).toString("base64")}`;
    this.baseUrl = configuration.site;
    this.cloudId = configuration.cloudId;
    this.restBase = this.baseUrl || `https://api.atlassian.com/ex/jira/${encodeURIComponent(this.cloudId)}`;
    this.metadata = { projects: [], columns: [], statuses: [], priorities: [], boardName: null };
    this.tail = Promise.resolve();
    this.created = new Map();
    this.active = true;
  }

  exclusive(work) {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }

  async request(pathname, { method = "GET", body, raw = false } = {}) {
    if (!this.active) throw jiraError("Jira sync is paused.", 503, { retryable: true });
    if (!/^\/rest\/(?:api\/3|agile\/1\.0|software\/1\.0)\//.test(pathname) || pathname.includes("..") || pathname.includes("#")) throw jiraError("Invalid Jira API request.");
    let response;
    try {
      response = await this.fetch(`${this.restBase}${pathname}`, {
        method, redirect: "manual", signal: AbortSignal.timeout(method === "GET" ? 10000 : 45000),
        headers: { Accept: "application/json", Authorization: this.authorization, ...(body instanceof FormData ? { "X-Atlassian-Token": "no-check" } : body ? { "Content-Type": "application/json" } : {}) },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw jiraError(method === "GET" ? "Unable to reach Jira. Your changes will remain saved on this device." : "Jira did not confirm the change. Check Jira before retrying; it may already have been saved.", 502, { retryable: true, uncertain: method !== "GET" });
    }
    if (response.status === 204) return null;
    if (raw && response.ok) {
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES) throw jiraError("This attachment exceeds the app's 25 MB offline file limit.", 413);
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    let result;
    try {
      const body = await response.text();
      if (!body && method === "POST" && pathname === "/rest/api/3/issueLink" && response.status === 201) return null;
      result = JSON.parse(body);
    }
    catch {
      if (response.ok) throw jiraError("Jira's response could not be read. Your change will be checked before retrying.", 502, { retryable: true, uncertain: method !== "GET" });
      result = {};
    }
    if (!response.ok) {
      const details = [...(result.errorMessages || []), ...Object.entries(result.errors || {}).map(([field, message]) => `${field}: ${message}`)].join(" ").slice(0, 2000);
      const message = response.status === 401 ? "Jira rejected the API token. Check your token and its expiry date." : response.status === 403 ? `Jira denied this action. Check your project permissions and API token scopes.${details ? ` ${details}` : ""}` : response.status === 429 ? "Jira is rate limiting requests. Wait a moment and try again." : details || `Jira returned ${response.status}.`;
      throw jiraError(message, response.status >= 500 ? 502 : response.status, { retryable: response.status >= 500 || response.status === 429, uncertain: method !== "GET" && response.status >= 500 });
    }
    return result;
  }

  async verify() {
    this.identity = verifyIdentity(await this.request("/rest/api/3/myself"), this.configuration.email);
    return this.identity;
  }

  async initialise() {
    try { await this.verify(); }
    catch (error) {
      if (!this.baseUrl || ![401, 403].includes(error.status)) throw error;
      // Scoped API tokens use Atlassian's API gateway. Discover its cloud ID
      // from the configured site without sending a credential to another host.
      const response = await this.fetch(`${this.baseUrl}/_edge/tenant_info`, { redirect: "error", signal: AbortSignal.timeout(15000) });
      const tenant = await response.json();
      if (!response.ok || !/^[a-f0-9-]{36}$/i.test(tenant.cloudId || "")) throw error;
      this.cloudId = tenant.cloudId;
      this.restBase = `https://api.atlassian.com/ex/jira/${this.cloudId}`;
      await this.verify();
    }
    if (!this.baseUrl) {
      this.baseUrl = jiraSiteOrigin((await this.request("/rest/api/3/serverInfo")).baseUrl);
      if (!this.baseUrl) throw jiraError("Use a direct Jira board URL in config/app.json.");
    }
    await this.loadMetadata();
    return this;
  }

  async loadMetadata() {
    const request = (path) => this.request(path);
    const boardId = this.configuration.boardId;
    const [board, boardConfig, statuses, priorities, linkTypes, attachmentSettings] = await Promise.all([
      boardId ? request(`/rest/agile/1.0/board/${boardId}`) : null,
      boardId ? request(`/rest/agile/1.0/board/${boardId}/configuration`).catch(() => null) : null,
      request("/rest/api/3/status").catch(() => []), request("/rest/api/3/priority").catch(() => []),
      request("/rest/api/3/issueLinkType").catch(() => ({ issueLinkTypes: [] })), request("/rest/api/3/attachment/meta").catch(() => ({ enabled: false })),
    ]);
    if (boardId && String(board?.id) !== String(boardId)) throw jiraError("Jira did not return the configured board.");
    let projects = boardId ? await jiraPages(request, `/rest/agile/1.0/board/${boardId}/project`).catch(() => []) : await jiraPages(request, "/rest/api/3/project/search");
    const projectReference = board?.location?.projectId || board?.location?.projectKey || new URL(this.configuration.jiraUrl).pathname.match(/\/projects\/([A-Z][A-Z0-9_]*)/i)?.[1];
    if (projectReference && !projects.some((project) => String(project.id) === String(projectReference) || project.key === projectReference)) {
      projects.push(await request(`/rest/api/3/project/${encodeURIComponent(projectReference)}`));
    }
    projects = [...new Map(projects.map((project) => [String(project.id), { id: String(project.id), key: project.key, name: project.name }])).values()];
    const mapped = new Map((Array.isArray(statuses) ? statuses : []).map((status) => [String(status.id), { id: String(status.id), name: status.name, category: status.statusCategory?.key }]));
    const columns = (boardConfig?.columnConfig?.columns || []).map((column, index, all) => ({
      id: `jira-column-${index}`, name: column.name, done: index === all.length - 1,
      statuses: (column.statuses || []).map((status) => mapped.get(String(status.id)) || { id: String(status.id), name: column.name, category: index === all.length - 1 ? "done" : "indeterminate" }),
    }));
    this.metadata = {
      boardName: board?.name || null, projects, columns, statuses: [...mapped.values()],
      priorities: (Array.isArray(priorities) ? priorities : []).map(({ id, name }) => ({ id: String(id), name })),
      linkTypes: linkTypes.issueLinkTypes || [], attachmentSettings,
    };
    this.metadataFetchedAt = Date.now();
  }

  async snapshot() {
    return this.exclusive(async () => {
      await this.verify();
      if (Date.now() - this.metadataFetchedAt > 300000) await this.loadMetadata();
      const snapshotStartedAt = new Date().toISOString();
      const issues = await readJiraIssues((path) => this.request(path), { boardId: this.configuration.boardId, accountId: this.identity.accountId });
      return { issues, snapshotStartedAt };
    });
  }

  project(projectId) {
    const project = this.metadata.projects.find((project) => project.id === String(projectId) || project.key === projectId);
    if (!project) throw jiraError("Choose a project from the configured Jira board.");
    return project;
  }

  async createContext(projectId, issueTypeId) {
    await this.verify();
    const project = this.project(projectId || this.metadata.projects[0]?.id);
    const issueTypes = await jiraPages((path) => this.request(path), `/rest/api/3/issue/createmeta/${project.id}/issuetypes`, "issueTypes");
    const type = issueTypes.find((type) => String(type.id) === String(issueTypeId)) || (!issueTypeId ? issueTypes.find((type) => !type.subtask && /^task$/i.test(type.name)) || issueTypes.find((type) => type.hierarchyLevel === 0) || issueTypes.find((type) => !type.subtask) || issueTypes[0] : null);
    if (!type) throw jiraError("You cannot create that issue type in this project.");
    const fields = publicFields(await jiraPages((path) => this.request(path), `/rest/api/3/issue/createmeta/${project.id}/issuetypes/${type.id}`, "fields"));
    const priority = fields.find((field) => field.fieldId === "priority");
    const medium = priority?.allowedValues.find((value) => /^medium$/i.test(value.name || value.value || ""));
    if (medium) priority.defaultValue = medium;
    if (type.subtask) {
      const parent = fields.find((field) => field.fieldId === "parent");
      if (parent) { parent.required = true; parent.hasDefaultValue = false; }
      else fields.push({ fieldId: "parent", name: "Parent issue", required: true, hasDefaultValue: false, schema: { type: "issuelink" }, allowedValues: [] });
    }
    return { projects: this.metadata.projects, project, issueTypes: issueTypes.map(({ id, name, subtask }) => ({ id: String(id), name, subtask: Boolean(subtask) })), issueType: { id: String(type.id), name: type.name, subtask: Boolean(type.subtask) }, fields, accountId: this.identity.accountId };
  }

  async issue(key) {
    if (!validIssueKey(key)) throw jiraError("Invalid Jira issue key.");
    return this.request(`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`);
  }

  async scopedIssue(key) {
    if (!validIssueKey(key)) throw jiraError("Invalid Jira issue key.");
    const found = await readJiraIssues((path) => this.request(path), { boardId: this.configuration.boardId, accountId: this.identity.accountId, keys: [key] });
    if (!found.some((issue) => issue.key === key)) throw jiraError("This issue is outside your configured Jira board.", 403);
    return this.issue(key);
  }

  async transitionOptions(key) {
    const result = await this.request(`/rest/api/3/issue/${key}/transitions?expand=transitions.fields`);
    return (result.transitions || []).filter((transition) => transition.isAvailable !== false).map((transition) => ({
      id: String(transition.id), name: transition.name,
      to: { id: String(transition.to.id), name: transition.to.name, category: transition.to.statusCategory?.key },
      fields: publicFields(transition.fields),
    }));
  }

  async editContext(key) {
    await this.verify();
    const issue = await this.scopedIssue(key);
    const [edit, transitions] = await Promise.all([this.request(`/rest/api/3/issue/${key}/editmeta`), this.transitionOptions(key)]);
    return { issue, fields: publicFields(edit.fields), transitions, accountId: this.identity.accountId };
  }

  async create(payload) {
    return this.exclusive(async () => {
      if (!/^[a-f0-9-]{36}$/i.test(payload.requestId || "")) throw jiraError("A creation request ID is required.");
      const context = await this.createContext(payload.projectId, payload.issueTypeId);
      const { fields } = personalFields(context.fields, payload.fields, this.identity.accountId, { creating: true, subtask: context.issueType.subtask });
      fields.project = { id: context.project.id };
      fields.issuetype = { id: context.issueType.id };
      if (fields.parent) {
        const parent = await this.scopedIssue(fields.parent.key);
        if (String(parent.fields.project?.id) !== context.project.id || parent.fields.issuetype?.subtask) throw jiraError("Choose a parent task in the same project, rather than another subtask.");
      }
      const signature = createHash("sha256").update(JSON.stringify(canonical(fields))).digest("hex");
      const receipt = this.created.get(payload.requestId) || await this.readReceipt(payload.requestId);
      if (receipt && receipt.signature !== signature) throw jiraError("This request ID has already been used. Reopen New task to create a different issue.", 409);
      let key = receipt?.key;
      let warning = "";
      if (receipt && ["pending", "unknown"].includes(receipt.state) || payload.recoverOnly && !key) {
        const found = await this.findCreation(payload.requestId, context.project.id);
        if (!found) throw jiraError("Jira has not confirmed the previous creation. Check Jira before retrying this task.", 409, { uncertain: true });
        key = found.key;
        await this.writeReceipt(payload.requestId, { signature, state: "created", key });
      }
      if (!key) {
        await this.writeReceipt(payload.requestId, { signature, state: "pending" });
        let created;
        try { created = await this.request("/rest/api/3/issue", { method: "POST", body: { fields, properties: [{ key: OPERATION_PROPERTY, value: { id: payload.requestId } }] } }); }
        catch (error) { await this.writeReceipt(payload.requestId, { signature, state: error.uncertain ? "unknown" : "rejected" }); throw error; }
        key = created.key;
        if (!validIssueKey(key)) throw jiraError("Jira did not return the new issue key. Check Jira before retrying.", 502, { uncertain: true });
        const completed = { signature, state: "created", key };
        this.created.set(payload.requestId, completed);
        try { await this.writeReceipt(payload.requestId, completed); }
        catch { warning = "The issue was created, but its local creation receipt could not be saved. Do not submit it again."; }
      }
      if (!context.fields.some((field) => field.fieldId === "assignee")) await this.request(`/rest/api/3/issue/${key}/assignee`, { method: "PUT", body: { accountId: this.identity.accountId } });
      let issue;
      try { issue = await this.issue(key); }
      catch { warning = `${warning} Created ${key} in Jira, but it could not be refreshed. Sync again to load its details.`.trim(); }
      const draft = { id: key, key, fields: { ...fields, summary: fields.summary, reporter: { accountId: this.identity.accountId }, created: new Date().toISOString() } };
      return { key, issue: issue || draft, warning, created: true, baseUrl: this.baseUrl, accountId: this.identity.accountId, snapshotStartedAt: new Date().toISOString() };
    });
  }

  async transition(key, { targetStatusId, targetColumnId, action, transitionFields = {} }, current) {
    const column = targetColumnId ? this.metadata.columns.find((column) => column.id === targetColumnId) : null;
    if (targetColumnId && !column) throw jiraError("Choose a column from your Jira board.");
    if (column?.statuses.some((status) => status.id === String(current.fields.status?.id))) return current;
    if (targetStatusId && String(current.fields.status?.id) === String(targetStatusId)) return current;
    if (action === "done" && current.fields.status?.statusCategory?.key === "done") return current;
    const transitions = await this.transitionOptions(key);
    const firstColumn = this.metadata.columns.find((column) => !column.done);
    const transition = targetStatusId ? transitions.find((transition) => transition.to.id === String(targetStatusId)) : column ? transitions.find((transition) => column.statuses.some((status) => status.id === transition.to.id)) : action === "done" ? transitions.find((transition) => transition.to.category === "done") : transitions.find((transition) => firstColumn?.statuses.some((status) => status.id === transition.to.id)) || transitions.find((transition) => transition.to.category !== "done");
    if (!transition) throw jiraError("Jira does not allow this status change from the current state. Open the task to see available transitions.", 409);
    const { fields } = personalFields(transition.fields, transitionFields, this.identity.accountId);
    for (const field of transition.fields) if (field.required && !field.hasDefaultValue && (fields[field.fieldId] === undefined || fields[field.fieldId] === null || fields[field.fieldId] === "")) throw jiraError(`Jira requires ${field.name} for this status change. Set it in task details.`);
    await this.request(`/rest/api/3/issue/${key}/transitions`, { method: "POST", body: { transition: { id: transition.id }, ...(Object.keys(fields).length ? { fields } : {}) } });
    return this.issue(key);
  }

  async update(key, payload) {
    return this.exclusive(async () => {
      await this.verify();
      let current = await this.scopedIssue(key);
      if (payload.expectedUpdatedAt && normalizedDate(current.fields.updated) !== normalizedDate(payload.expectedUpdatedAt)) throw jiraError("This task changed in Jira. Reload its details before saving so those changes are not overwritten.", 409);
      if ((payload.fields && Object.keys(payload.fields).length) || current.fields.assignee?.accountId !== this.identity.accountId) {
        const metadata = publicFields((await this.request(`/rest/api/3/issue/${key}/editmeta`)).fields);
        const { fields } = personalFields(metadata, payload.fields || {}, this.identity.accountId);
        if (!metadata.some((field) => field.fieldId === "assignee") && current.fields.assignee?.accountId !== this.identity.accountId) await this.request(`/rest/api/3/issue/${key}/assignee`, { method: "PUT", body: { accountId: this.identity.accountId } });
        await this.request(`/rest/api/3/issue/${key}`, { method: "PUT", body: { fields } });
        current = await this.issue(key);
      }
      if (payload.targetStatusId || payload.targetColumnId || payload.action === "done" || payload.action === "restore") {
        try { current = await this.transition(key, payload, current); }
        catch (error) {
          if (payload.fields && Object.keys(payload.fields).length) return { issue: current, warning: `Fields were saved in Jira, but the status was not changed: ${error.message}` };
          throw error;
        }
      }
      return { issue: current };
    });
  }

  async findCreation(requestId, projectId) {
    let nextPageToken;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ jql: `project = ${JSON.stringify(String(projectId))} AND creator = currentUser() AND created >= -30d ORDER BY created DESC`, fields: ISSUE_FIELDS, properties: OPERATION_PROPERTY, maxResults: "100" });
      if (nextPageToken) query.set("nextPageToken", nextPageToken);
      const result = await this.request(`/rest/api/3/search/jql?${query}`);
      for (const issue of result.issues || []) {
        const property = issue.properties?.[OPERATION_PROPERTY] || (await this.request(`/rest/api/3/issue/${issue.key}/properties/${OPERATION_PROPERTY}`).catch((error) => { if (error.status === 404) return null; throw error; }))?.value;
        if (property?.id === requestId) return issue;
      }
      if (result.isLast === true || !result.nextPageToken) return null;
      nextPageToken = result.nextPageToken;
    }
    throw jiraError("Jira's creation history could not be fully checked. Check Jira before retrying.", 409, { uncertain: true });
  }

  async allowCreateRetry(requestId) {
    const receipt = await this.readReceipt(requestId);
    if (receipt && ["pending", "unknown"].includes(receipt.state)) await this.writeReceipt(requestId, { ...receipt, state: "rejected" });
    this.created.delete(requestId);
  }

  async comments(key) {
    return jiraPages((path) => this.request(path), `/rest/api/3/issue/${key}/comment?expand=properties`, "comments");
  }

  async details(key) {
    await this.verify();
    const issue = await this.scopedIssue(key);
    const [comments, types, attachmentSettings] = await Promise.all([
      this.comments(key), this.request("/rest/api/3/issueLinkType").catch(() => ({ issueLinkTypes: [] })),
      this.request("/rest/api/3/attachment/meta").catch(() => ({ enabled: false })),
    ]);
    return { issue, comments, attachments: issue.fields.attachment || [], links: issue.fields.issuelinks || [], linkTypes: types.issueLinkTypes || [], attachmentSettings };
  }

  async findComment(key, operationId) {
    for (const comment of await this.comments(key)) {
      const property = comment.properties?.find((property) => property.key === OPERATION_PROPERTY)?.value ||
        (await this.request(`/rest/api/3/comment/${comment.id}/properties/${OPERATION_PROPERTY}`).catch((error) => { if (error.status === 404) return null; throw error; }))?.value;
      if (property?.id === operationId) return comment;
    }
    return null;
  }

  async addComment(key, body, operationId) {
    await this.verify(); await this.scopedIssue(key);
    return this.request(`/rest/api/3/issue/${key}/comment`, { method: "POST", body: { body: toAdf(body), properties: [{ key: OPERATION_PROPERTY, value: { id: operationId } }] } });
  }

  async editComment(key, id, body) {
    await this.verify(); await this.scopedIssue(key);
    const comment = await this.request(`/rest/api/3/issue/${key}/comment/${encodeURIComponent(id)}`);
    if (comment.author?.accountId !== this.identity.accountId) throw jiraError("Only your own comments can be changed here.", 403);
    if (body === null) { await this.request(`/rest/api/3/issue/${key}/comment/${id}`, { method: "DELETE" }); return null; }
    return this.request(`/rest/api/3/issue/${key}/comment/${id}`, { method: "PUT", body: { body: toAdf(body) } });
  }

  async addLink(key, targetKey, typeId, direction) {
    await this.verify(); await this.scopedIssue(key); await this.issue(targetKey);
    if (key === targetKey || !["inward", "outward"].includes(direction)) throw jiraError("Choose another task and a link relationship.");
    const types = (await this.request("/rest/api/3/issueLinkType")).issueLinkTypes || [];
    if (!types.some((type) => String(type.id) === String(typeId))) throw jiraError("Choose a link type from Jira.");
    await this.request("/rest/api/3/issueLink", { method: "POST", body: { type: { id: String(typeId) }, inwardIssue: { key: direction === "outward" ? key : targetKey }, outwardIssue: { key: direction === "outward" ? targetKey : key } } });
    return this.issue(key);
  }

  async removeLink(key, id) {
    await this.verify(); const issue = await this.scopedIssue(key);
    if (!(issue.fields.issuelinks || []).some((link) => String(link.id) === String(id))) throw jiraError("This link is no longer on the task.", 404);
    await this.request(`/rest/api/3/issueLink/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async uploadAttachment(key, { filename, mimeType, data }) {
    await this.verify(); await this.scopedIssue(key);
    const form = new FormData(); form.append("file", new Blob([data], { type: mimeType || "application/octet-stream" }), filename);
    return this.request(`/rest/api/3/issue/${key}/attachments`, { method: "POST", body: form });
  }

  async attachmentContent(id) {
    if (!/^\d+$/.test(String(id))) throw jiraError("Invalid attachment.");
    return this.request(`/rest/api/3/attachment/content/${id}?redirect=false`, { raw: true });
  }

  async removeAttachment(key, id) {
    await this.verify(); const issue = await this.scopedIssue(key);
    if (!(issue.fields.attachment || []).some((file) => String(file.id) === String(id))) throw jiraError("This attachment is no longer on the task.", 404);
    await this.request(`/rest/api/3/attachment/${id}`, { method: "DELETE" });
  }

  async remove(key) {
    return this.exclusive(async () => {
      await this.verify();
      await this.scopedIssue(key);
      // Never delete unselected subtasks implicitly.
      await this.request(`/rest/api/3/issue/${key}?deleteSubtasks=false`, { method: "DELETE" });
      return { key, deleted: true };
    });
  }

  async bulk(action, keys) {
    if (!["done", "delete"].includes(action) || !Array.isArray(keys) || !keys.length || keys.some((key) => !validIssueKey(key))) throw jiraError("Invalid Jira bulk request.");
    const succeeded = [], failed = [];
    // Deleting subtasks first allows a selected parent to be deleted afterwards.
    let ordered = [...new Set(keys)];
    if (action === "delete") {
      await this.verify();
      const rows = await Promise.all(ordered.map(async (key) => ({ key, issue: await this.issue(key).catch(() => null) })));
      ordered = rows.sort((a, b) => Number(Boolean(b.issue?.fields.issuetype?.subtask)) - Number(Boolean(a.issue?.fields.issuetype?.subtask))).map(({ key }) => key);
    }
    for (const key of ordered) {
      try { succeeded.push(action === "delete" ? await this.remove(key) : { key, ...await this.update(key, { action: "done" }) }); }
      catch (error) { failed.push({ key, error: error.message }); }
    }
    return { succeeded, failed };
  }
}
