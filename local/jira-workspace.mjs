import { randomUUID, createHash } from "node:crypto";
import { configurationId } from "../config/settings.mjs";
import { workspaceStore } from "./jira-store.mjs";
import { adfText, comparableField, jiraError, MAX_ATTACHMENT_BYTES, personalFields, validLocalKey, validTaskKey, toAdf } from "../lib/jira-fields.mjs";

const copy = (value) => structuredClone(value);
const uuid = (value) => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const retryable = (error) => error.retryable || error.status >= 500 || error.status === 429;
const freshState = () => ({ version: 1, configId: configurationId, revision: 1, profile: null, issues: {}, createContexts: {}, editContexts: {}, details: {}, queue: [], aliases: {}, itemAliases: {}, deletedKeys: [], recentCreates: {}, requests: {}, lastSyncedAt: null });
const operationLabels = { create: "Create task", update: "Update task", delete: "Delete task", "comment-add": "Add comment", "comment-edit": "Edit comment", "comment-delete": "Delete comment", "attachment-add": "Upload attachment", "attachment-delete": "Delete attachment", "link-add": "Link tasks", "link-delete": "Remove issue link" };

export class JiraWorkspace {
  constructor({ store = workspaceStore(), now = () => new Date().toISOString() } = {}) {
    this.store = store; this.now = now; this.state = freshState(); this.loaded = null; this.tail = Promise.resolve();
  }
  async load() {
    this.loaded ||= (async () => {
      const saved = await this.store.readState();
      if (saved) {
        if (saved.version !== 1 || saved.configId !== configurationId || !Array.isArray(saved.queue)) throw new Error("This offline workspace belongs to another configuration. Saved changes have not been changed.");
        this.state = { ...freshState(), ...saved };
        for (const op of this.state.queue) if (op.status === "sending") {
          op.status = ["create", "comment-add", "attachment-add"].includes(op.type) ? "uncertain" : "pending";
          op.error = "The app stopped before Jira confirmed this change. It will be checked before replaying.";
        }
      }
    })();
    return this.loaded;
  }
  run(work) {
    const result = this.tail.then(async () => { await this.load(); return work(); });
    this.tail = result.catch(() => {}); return result;
  }
  async save() { this.state.revision++; await this.store.writeState(copy(this.state)); }
  async transaction(work) {
    const before = copy(this.state);
    try { const result = await work(); await this.save(); return result; }
    catch (error) { this.state = before; throw error; }
  }
  resolve(key) { return this.state.aliases[key] || key; }
  itemId(id) { return this.state.itemAliases[id] || id; }
  get profile() { return this.state.profile; }
  get available() { return Boolean(this.profile && Object.keys(this.state.createContexts).length); }
  pending(key) { const resolved = this.resolve(key); return this.state.queue.filter((op) => this.resolve(op.key) === resolved); }
  queueSummary() {
    const entries = this.state.queue.map((op) => ({ id: op.id, key: this.resolve(op.key), type: op.type, label: operationLabels[op.type], title: this.viewIssue(op.key)?.fields.summary || op.payload?.fields?.summary || op.key, status: op.status, error: op.error || "", conflicts: op.conflicts || [], createdAt: op.createdAt }));
    return { pending: entries.length, attention: entries.filter((entry) => ["failed", "conflict", "uncertain"].includes(entry.status)).length, entries, lastSyncedAt: this.state.lastSyncedAt, revision: this.state.revision };
  }
  contextForIssue(issue) {
    return this.state.createContexts[`${issue?.fields.project?.id}:${issue?.fields.issuetype?.id}`] || Object.values(this.state.createContexts).find((context) => context.project.id === String(issue?.fields.project?.id));
  }
  statusFor(payload, currentStatus) {
    const columns = this.profile?.metadata.columns || [];
    const boardStatuses = columns.flatMap((column) => column.statuses);
    const statuses = boardStatuses.length ? boardStatuses : this.profile?.metadata.statuses || [];
    const status = payload.targetStatusId ? statuses.find((status) => status.id === payload.targetStatusId) : payload.targetColumnId ? columns.find((column) => column.id === payload.targetColumnId)?.statuses[0] : payload.action === "done" ? statuses.find((status) => status.category === "done") : payload.action === "restore" ? columns.find((column) => !column.done)?.statuses[0] : null;
    if (payload.targetStatusId || payload.targetColumnId || payload.action) {
      if (!status) throw jiraError("This workflow status has not been cached. Connect Jira once to load your board's statuses.");
      return { id: status.id, name: status.name, statusCategory: { key: status.category || "indeterminate" } };
    }
    return currentStatus;
  }
  commentsFor(inputKey) {
    const key = this.resolve(inputKey), comments = copy(this.state.details[key]?.comments || []);
    for (const op of this.pending(key)) {
      const id = this.itemId(`local:${op.id}`), payload = op.payload;
      if (op.type === "comment-add") comments.push({ id, body: toAdf(payload.body), author: this.profile.identity, created: op.createdAt, updated: op.createdAt, pending: true });
      if (op.type === "comment-edit") {
        const comment = comments.find((comment) => String(comment.id) === this.itemId(payload.commentId));
        if (comment) Object.assign(comment, { body: toAdf(payload.body), updated: op.createdAt, pending: true });
      }
      if (op.type === "comment-delete") { const index = comments.findIndex((comment) => String(comment.id) === this.itemId(payload.commentId)); if (index >= 0) comments.splice(index, 1); }
    }
    return comments;
  }
  viewIssue(inputKey) {
    const key = this.resolve(inputKey);
    let issue = this.state.issues[key] ? copy(this.state.issues[key]) : null;
    for (const op of this.pending(key)) {
      if (op.type === "create") issue = copy(op.draft);
      if (!issue) continue;
      if (op.type === "update") {
        Object.assign(issue.fields, copy(op.prepared || {}));
        issue.fields.status = this.statusFor(op.payload, issue.fields.status);
        if (issue.fields.priority?.id) issue.fields.priority = this.profile.metadata.priorities.find((priority) => priority.id === issue.fields.priority.id) || issue.fields.priority;
      }
      if (op.type === "delete") issue.syncDeleted = true;
      issue.syncStatus = issue.syncStatus === "attention" || ["failed", "conflict", "uncertain"].includes(op.status) ? "attention" : op.type === "delete" ? "pending-delete" : "pending";
      issue.syncError = op.error || issue.syncError || "";
    }
    if (!issue) return null;
    issue.key = key; issue.syncRevision = this.state.revision;
    issue.syncStatus ||= "synced";
    if (issue.fields.parent?.key) issue.fields.parent.key = this.resolve(issue.fields.parent.key);
    issue.cachedComments = this.commentsFor(key).map((comment) => ({ id: String(comment.id), body: adfText(comment.body).trimEnd(), author: comment.author?.displayName || "You", createdAt: comment.created || "", updatedAt: comment.updated || comment.created || "", pending: Boolean(comment.pending) })).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    return issue;
  }
  snapshot() {
    const keys = new Set([...Object.keys(this.state.issues), ...this.state.queue.filter((op) => op.type === "create").map((op) => op.key)]);
    return { issues: [...keys].map((key) => this.viewIssue(key)).filter(Boolean), aliases: copy(this.state.aliases), deletedKeys: [...this.state.deletedKeys], revision: this.state.revision, snapshotStartedAt: this.now(), queue: this.queueSummary() };
  }
  async prime(client) {
    const profile = { identity: copy(client.identity), baseUrl: client.baseUrl, cloudId: client.cloudId, metadata: copy(client.metadata) };
    this.state.profile = profile;
    for (const project of client.metadata.projects) {
      const context = await client.createContext(project.id);
      this.state.createContexts[`${project.id}:${context.issueType.id}`] = context;
      const child = context.issueTypes.find((type) => type.subtask);
      if (child) this.state.createContexts[`${project.id}:${child.id}`] = await client.createContext(project.id, child.id);
    }
    await this.save();
  }
  async createContext(payload = {}, client = null) {
    if (!this.profile) throw jiraError("Connect Jira once to cache your board before working offline.", 503);
    const parent = payload.parentKey ? this.viewIssue(payload.parentKey) : null;
    if (payload.parentKey && (!parent || parent.fields.issuetype?.subtask)) throw jiraError("Choose an existing parent task, rather than another subtask.");
    const projectId = String(parent?.fields.project?.id || payload.projectId || this.profile.metadata.projects[0]?.id || "");
    const known = Object.values(this.state.createContexts).find((context) => context.project.id === projectId);
    const typeId = parent ? known?.issueTypes.find((type) => type.subtask)?.id : payload.issueTypeId || known?.issueTypes.find((type) => /^task$/i.test(type.name))?.id || known?.issueType.id;
    const cached = this.state.createContexts[`${projectId}:${typeId}`];
    if (cached) return { ...copy(cached), offline: !client };
    if (!client) throw jiraError("These Jira fields have not been cached. Connect Jira once to load them.", 503);
    const context = await client.createContext(projectId, typeId);
    this.state.createContexts[`${projectId}:${context.issueType.id}`] = context; await this.save(); return copy(context);
  }
  async editContext(key, client = null) {
    const resolved = this.resolve(key);
    if (client && !validLocalKey(resolved) && !this.pending(resolved).length) {
      try {
        const context = await client.editContext(resolved);
        this.state.editContexts[resolved] = context; this.state.issues[resolved] = context.issue; await this.save();
      } catch (error) { if (!retryable(error)) throw error; }
    }
    const issue = this.viewIssue(resolved);
    if (!issue) throw jiraError("Task not found in your cached board.", 404);
    const cached = this.state.editContexts[resolved];
    const creation = this.contextForIssue(issue);
    const columns = this.profile.metadata.columns.flatMap((column) => column.statuses);
    const transitions = (columns.length ? columns : this.profile.metadata.statuses || []).map((status) => ({ id: `cached-${status.id}`, name: status.name, to: status, fields: [] }));
    return { ...(cached ? copy(cached) : { fields: copy(creation?.fields || []), transitions }), issue, accountId: this.profile.identity.accountId, offline: !client, subtasks: this.children(resolved) };
  }
  children(key) {
    const parent = this.resolve(key);
    return this.snapshot().issues.filter((issue) => !issue.syncDeleted && issue.fields.parent?.key === parent).map((issue) => ({ key: issue.key, summary: issue.fields.summary, status: issue.fields.status?.name || "", syncStatus: issue.syncStatus }));
  }
  makeOperation(type, key, payload, extra = {}) {
    return { id: uuid(payload.operationId) ? payload.operationId : randomUUID(), type, key, payload: copy(payload), status: "pending", createdAt: this.now(), ...extra };
  }
  prepareCreate(payload, context, parentKey) {
    if (!uuid(payload.requestId)) throw jiraError("A creation request ID is required.");
    const key = `local:${payload.requestId}`;
    const fieldsInput = { ...payload.fields, ...(parentKey ? { parent: parentKey } : {}) };
    const { input, fields } = personalFields(context.fields, fieldsInput, this.profile.identity.accountId, { creating: true, subtask: context.issueType.subtask });
    if (fields.parent) {
      const parent = this.viewIssue(fields.parent.key);
      if (!parent || parent.fields.project?.id !== context.project.id || parent.fields.issuetype?.subtask) throw jiraError("Choose a parent task in this project.");
    }
    const status = this.profile.metadata.columns[0]?.statuses[0] || this.profile.metadata.statuses.find((status) => status.category !== "done");
    const draft = { id: key, key, fields: { ...fields, project: context.project, issuetype: context.issueType, assignee: this.profile.identity, reporter: this.profile.identity, priority: this.profile.metadata.priorities.find((priority) => priority.id === fields.priority?.id) || { name: "Medium" }, status: { id: status?.id, name: status?.name || "To Do", statusCategory: { key: status?.category || "new" } }, created: this.now(), updated: this.now(), subtasks: [], attachment: [], issuelinks: [] } };
    return this.makeOperation("create", key, { requestId: payload.requestId, projectId: context.project.id, issueTypeId: context.issueType.id, fields: input }, { id: payload.requestId, draft });
  }
  async create(payload, client) {
    const key = `local:${payload.requestId}`;
    const signature = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    if (this.state.requests[payload.requestId] && this.state.requests[payload.requestId] !== signature) throw jiraError("This task was already saved with different details. Close and reopen the form before creating another task.", 409);
    if (this.resolve(key) !== key || this.state.queue.some((op) => op.id === payload.requestId)) return { key: this.resolve(key), issue: this.viewIssue(key), pending: this.pending(key).length > 0 };
    const context = await this.createContext(payload, client);
    const childType = context.issueTypes.find((type) => type.subtask);
    const childContext = payload.subtasks?.length ? await this.createContext({ projectId: context.project.id, issueTypeId: childType?.id }, client) : null;
    if (payload.subtasks?.length && !childContext?.issueType.subtask) throw jiraError("Jira does not allow subtasks in this project.");
    let parentOp;
    await this.transaction(async () => {
      parentOp = this.prepareCreate(payload, context, payload.parentKey);
      this.state.requests[payload.requestId] = signature;
      this.state.queue.push(parentOp);
      for (const child of payload.subtasks || []) {
        this.state.queue.push(this.prepareCreate(child, childContext, key));
      }
    });
    return { key, issue: this.viewIssue(key), pending: true, created: true };
  }
  async update(key, payload) {
    const current = this.viewIssue(key);
    if (!current || current.syncDeleted) throw jiraError("Task not found.", 404);
    const context = await this.editContext(key, null);
    const { input, fields } = personalFields(context.fields, payload.fields || {}, this.profile.identity.accountId);
    this.statusFor(payload, current.fields.status);
    const next = { ...payload, fields: input };
    const base = payload.baseFields && typeof payload.baseFields === "object" ? payload.baseFields : current.fields;
    await this.transaction(() => this.state.queue.push(this.makeOperation("update", key, next, { base: copy(base), prepared: fields })));
    return { key: this.resolve(key), issue: this.viewIssue(key), pending: true };
  }
  async remove(key) {
    const issue = this.viewIssue(key);
    if (!issue) throw jiraError("Task not found.", 404);
    if (validLocalKey(this.resolve(key))) {
      if (this.children(key).length) throw jiraError("Delete the selected subtasks before deleting their parent.", 409);
      const create = this.state.queue.find((op) => op.type === "create" && op.key === key);
      if (create?.status !== "uncertain") return this.discard(create.id, true);
    }
    await this.transaction(() => this.state.queue.push(this.makeOperation("delete", key, {}, { base: copy(issue.fields) })));
    return { key: this.resolve(key), issue: this.viewIssue(key), pending: true };
  }
  detailsView(key) {
    const resolved = this.resolve(key), issue = this.viewIssue(key);
    if (!issue) throw jiraError("Task not found.", 404);
    const details = copy(this.state.details[resolved] || { comments: [], attachments: issue.fields.attachment || [], links: issue.fields.issuelinks || [], linkTypes: this.profile.metadata.linkTypes || [], attachmentSettings: this.profile.metadata.attachmentSettings || { enabled: true, uploadLimit: MAX_ATTACHMENT_BYTES }, cached: validLocalKey(resolved) });
    details.comments = this.commentsFor(resolved);
    for (const op of this.pending(resolved)) {
      const id = this.itemId(`local:${op.id}`), payload = op.payload;
      if (op.type === "attachment-add") details.attachments.push({ id, filename: payload.filename, mimeType: payload.mimeType, size: payload.size, cachedBlob: payload.blobKey, availableOffline: true, pending: true });
      if (op.type === "attachment-delete") details.attachments = details.attachments.filter((file) => String(file.id) !== this.itemId(payload.attachmentId));
      if (op.type === "link-add") {
        const type = details.linkTypes.find((type) => String(type.id) === payload.typeId);
        details.links.push({ id, type, [payload.direction === "outward" ? "outwardIssue" : "inwardIssue"]: { key: this.resolve(payload.targetKey), fields: { summary: this.viewIssue(payload.targetKey)?.fields.summary || "" } }, pending: true });
      }
      if (op.type === "link-delete") details.links = details.links.filter((link) => String(link.id) !== this.itemId(payload.linkId));
    }
    return { ...details, issue, subtasks: this.children(resolved), accountId: this.profile.identity.accountId, queue: this.queueSummary() };
  }
  async details(key, client) {
    const resolved = this.resolve(key);
    if (client && !validLocalKey(resolved)) {
      try { await this.refreshDetails(resolved, client); }
      catch (error) { if (!retryable(error)) throw error; }
    }
    return this.detailsView(resolved);
  }
  cacheDetails(key, latest) {
    const cached = this.state.details[key];
    for (const file of latest.attachments) {
      const previous = cached?.attachments.find((attachment) => String(attachment.id) === String(file.id));
      if (previous?.cachedBlob) { file.cachedBlob = previous.cachedBlob; file.availableOffline = true; }
    }
    this.state.issues[key] = latest.issue; this.state.details[key] = { ...latest, cached: true };
  }
  async refreshDetails(key, client) { this.cacheDetails(key, await client.details(key)); await this.save(); }
  async activity(type, key, payload) {
    if (!this.viewIssue(key)) throw jiraError("Task not found.", 404);
    const signature = createHash("sha256").update(JSON.stringify({ type, payload: Object.fromEntries(Object.entries(payload).filter(([id]) => !["key", "operationId"].includes(id))) })).digest("hex");
    if (uuid(payload.operationId) && this.state.requests[payload.operationId]) {
      if (this.state.requests[payload.operationId] !== signature) throw jiraError("This request was already saved with different details. Reload the task before trying again.", 409);
      return this.detailsView(key);
    }
    const details = this.detailsView(key);
    let base;
    if (type.startsWith("comment")) {
      if (type !== "comment-delete" && (typeof payload.body !== "string" || !payload.body.trim() || payload.body.length > 32000)) throw jiraError("Enter a comment of at most 32,000 characters.");
      if (type !== "comment-add") {
        base = details.comments.find((comment) => String(comment.id) === payload.commentId);
        if (!base || base.author?.accountId !== this.profile.identity.accountId) throw jiraError("Only your own comments can be changed here.", 403);
      }
    }
    if (type === "link-add") {
      if (!validTaskKey(payload.targetKey) || this.resolve(payload.targetKey) === this.resolve(key) || !["inward", "outward"].includes(payload.direction) || !details.linkTypes.some((link) => String(link.id) === payload.typeId)) throw jiraError("Choose another task and a link type from Jira.");
    }
    if (type === "link-delete" && !details.links.some((link) => String(link.id) === payload.linkId)) throw jiraError("Link not found.", 404);
    if (type === "attachment-delete" && !details.attachments.some((file) => String(file.id) === payload.attachmentId)) throw jiraError("Attachment not found.", 404);
    if (["comment-delete", "attachment-delete", "link-delete"].includes(type) && payload.confirmDelete !== true) throw jiraError("Confirm removing this item first.");
    const targetId = payload.commentId || payload.attachmentId || payload.linkId;
    if (type.endsWith("-delete") && validLocalKey(targetId)) {
      const creator = this.state.queue.find((op) => `local:${op.id}` === targetId);
      if (creator && creator.status !== "uncertain") { await this.discard(creator.id, true); return this.detailsView(key); }
    }
    const op = this.makeOperation(type, key, payload, { base: base ? copy(base) : undefined });
    if (this.state.queue.some((existing) => existing.id === op.id)) return this.detailsView(key);
    await this.transaction(() => { this.state.queue.push(op); this.state.requests[op.id] = signature; }); return this.detailsView(key);
  }
  async attach(key, payload) {
    if (!this.viewIssue(key)) throw jiraError("Task not found.", 404);
    const data = Buffer.from(payload.data || "", "base64");
    if (!data.length || data.length > MAX_ATTACHMENT_BYTES || payload.filename?.length > 255 || typeof payload.filename !== "string" || /[\r\n/\\\0]/.test(payload.filename)) throw jiraError("Choose a file up to 25 MB with a valid filename.", 413);
    const id = uuid(payload.operationId) ? payload.operationId : randomUUID(), blobKey = `file-${id}`;
    const hash = createHash("sha256").update(data).digest("hex");
    const signature = createHash("sha256").update(JSON.stringify({ type: "attachment-add", filename: payload.filename, hash })).digest("hex");
    if (this.state.requests[id]) {
      if (this.state.requests[id] !== signature) throw jiraError("This upload request was already saved with a different file.", 409);
      return this.detailsView(key);
    }
    await this.store.writeBlob(blobKey, data);
    const op = this.makeOperation("attachment-add", key, { filename: payload.filename, mimeType: payload.mimeType || "application/octet-stream", size: data.length, blobKey, hash }, { id });
    await this.transaction(() => { this.state.queue.push(op); this.state.requests[id] = signature; }); return this.detailsView(key);
  }
  async attachment(key, id, client) {
    id = this.itemId(id);
    const details = this.detailsView(key), file = details.attachments.find((file) => String(file.id) === id);
    if (!file) throw jiraError("Attachment not found.", 404);
    const blobKey = file.cachedBlob || `attachment-${id}`;
    let data = await this.store.readBlob(blobKey);
    if (!data) {
      if (!client || validLocalKey(id)) throw jiraError("This file is not cached. Connect Jira and download it once for offline use.", 503);
      data = await client.attachmentContent(id); await this.store.writeBlob(blobKey, data);
      const stored = this.state.details[this.resolve(key)]?.attachments.find((file) => String(file.id) === id);
      if (stored) { stored.cachedBlob = blobKey; stored.availableOffline = true; await this.save(); }
    }
    return { filename: file.filename, mimeType: file.mimeType, data: data.toString("base64") };
  }
  async discard(id, confirmed) {
    if (!confirmed) throw jiraError("Confirm discarding these local changes first.");
    const op = this.state.queue.find((op) => op.id === id);
    if (!op) return { discarded: true };
    if (op.status === "sending" || op.status === "uncertain") throw jiraError("Jira may already have saved this change. Check Jira and resolve it before discarding.", 409);
    const removed = new Set(op.type === "create" ? [op.key] : []), ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of this.state.queue) if (!ids.has(entry.id) && (removed.has(entry.key) || removed.has(entry.payload.fields?.parent) || removed.has(entry.payload.targetKey) || entry.payload.commentId === `local:${id}`)) {
        ids.add(entry.id); if (entry.type === "create") removed.add(entry.key); changed = true;
      }
    }
    const blobs = this.state.queue.filter((entry) => ids.has(entry.id) && entry.payload.blobKey).map((entry) => entry.payload.blobKey);
    await this.transaction(() => { this.state.queue = this.state.queue.filter((entry) => !ids.has(entry.id)); for (const key of removed) { delete this.state.issues[key]; delete this.state.details[key]; this.state.deletedKeys.push(key); } });
    for (const blob of blobs) await this.store.deleteBlob(blob).catch(() => {});
    return { discarded: true, key: this.resolve(op.key), removedKeys: [...removed] };
  }
  async retry(id, confirmed, client) {
    const op = this.state.queue.find((op) => op.id === id);
    if (!op) return;
    if (!confirmed) throw jiraError("Review Jira and confirm retrying this saved change first.");
    if (op.status === "uncertain" && op.type === "create") {
      if (!client) throw jiraError("Connect Jira before retrying an unconfirmed creation.", 503);
      await client.allowCreateRetry(op.payload.requestId);
    }
    await this.transaction(() => {
      if (op.status === "conflict" && op.remoteBase) op.base = copy(op.remoteBase);
      op.status = "pending"; op.error = ""; op.conflicts = [];
    });
  }
  updateConflicts(op, current) {
    const conflicts = [];
    for (const [field, desired] of Object.entries(op.prepared || {})) {
      if (field === "assignee") continue;
      const original = comparableField(field, op.base?.[field]), remote = comparableField(field, current.fields[field]), local = comparableField(field, desired);
      if (!equal(remote, original) && !equal(remote, local)) conflicts.push({ field, local: typeof local === "string" ? local : JSON.stringify(local), remote: typeof remote === "string" ? remote : JSON.stringify(remote) });
    }
    const desiredStatus = this.statusFor(op.payload, current.fields.status);
    if (op.payload.targetStatusId || op.payload.targetColumnId || op.payload.action) {
      if (current.fields.status?.id !== op.base?.status?.id && current.fields.status?.id !== desiredStatus?.id) conflicts.push({ field: "Status", local: desiredStatus?.name, remote: current.fields.status?.name });
    }
    if (conflicts.length) throw jiraError("This task changed in Jira while you were editing. Review the differences before keeping your changes.", 409, { conflicts, remoteBase: current.fields });
  }
  async execute(op, client) {
    const key = this.resolve(op.key), payload = copy(op.payload);
    if (op.type === "create") {
      if (payload.fields.parent) payload.fields.parent = this.resolve(payload.fields.parent);
      if (validLocalKey(payload.fields.parent)) throw jiraError("Waiting for the parent task to sync.", 425, { dependency: true });
      const result = await client.create({ ...payload, recoverOnly: op.wasUncertain });
      return { createdKey: result.key, issue: result.issue };
    }
    if (validLocalKey(key)) throw jiraError("Waiting for the task to sync.", 425, { dependency: true });
    if (op.type === "update") {
      const current = await client.scopedIssue(key);
      this.updateConflicts(op, current);
      if (payload.fields.parent) payload.fields.parent = this.resolve(payload.fields.parent);
      const result = await client.update(key, { ...payload, expectedUpdatedAt: current.fields.updated });
      if (result.warning) throw jiraError(result.warning, 409, { remoteBase: result.issue.fields, partialIssue: result.issue });
      return { issue: result.issue };
    } else if (op.type === "delete") {
      let current;
      try { await client.issue(key); current = await client.scopedIssue(key); }
      catch (error) { if (error.status !== 404) throw error; }
      if (current) {
        const changed = ["summary", "description", "priority", "status"].some((field) => !equal(comparableField(field, current.fields[field]), comparableField(field, op.base?.[field])));
        if (changed && !op.wasUncertain) throw jiraError("This task changed in Jira before deletion. Review it before retrying.", 409, { remoteBase: current.fields });
        await client.remove(key);
      }
      return { deletedKey: key };
    } else if (op.type === "comment-add") {
      let comment = op.wasUncertain ? await client.findComment(key, op.id) : null;
      if (!comment && op.wasUncertain) throw jiraError("The comment has not been confirmed. Check Jira before retrying it.", 409, { uncertain: true });
      comment ||= await client.addComment(key, payload.body, op.id);
      return { itemAlias: String(comment.id), comment, details: await client.details(key).catch(() => null) };
    } else if (op.type.startsWith("comment-")) {
      const id = this.itemId(payload.commentId), comments = await client.comments(key), comment = comments.find((comment) => String(comment.id) === id);
      if (!comment && op.type === "comment-delete") return { commentRemoval: id };
      if (!comment) throw jiraError("The comment was removed in Jira.", 409);
      const current = adfText(comment.body).trimEnd(), base = adfText(op.base?.body).trimEnd();
      if (current !== base && current !== payload.body) throw jiraError("This comment changed in Jira. Review it before retrying.", 409, { remoteBase: comment });
      const edited = await client.editComment(key, id, op.type === "comment-delete" ? null : payload.body);
      return { ...(op.type === "comment-delete" ? { commentRemoval: id } : { comment: edited }), details: await client.details(key).catch(() => null) };
    } else if (op.type === "link-add") {
      const target = this.resolve(payload.targetKey);
      if (validLocalKey(target)) throw jiraError("Waiting for the linked task to sync.", 425, { dependency: true });
      await client.addLink(key, target, payload.typeId, payload.direction); return { details: await client.details(key) };
    } else if (op.type === "link-delete") {
      try { await client.removeLink(key, this.itemId(payload.linkId)); } catch (error) { if (error.status !== 404) throw error; }
      return { linkRemoval: this.itemId(payload.linkId), details: await client.details(key).catch(() => null) };
    } else if (op.type === "attachment-add") {
      const data = await this.store.readBlob(payload.blobKey);
      if (!data) throw jiraError("The saved attachment file could not be found. Add it again.", 409);
      let uploaded;
      if (op.wasUncertain) {
        const current = await client.issue(key);
        for (const file of current.fields.attachment || []) if (file.filename === payload.filename && file.size === payload.size) {
          const candidate = await client.attachmentContent(file.id);
          if (createHash("sha256").update(candidate).digest("hex") === payload.hash) { uploaded = file; break; }
        }
        if (!uploaded) throw jiraError("The file upload has not been confirmed. Check Jira before retrying it.", 409, { uncertain: true });
      }
      uploaded ||= (await client.uploadAttachment(key, { ...payload, data }))[0];
      if (!uploaded?.id) throw jiraError("Jira did not confirm the uploaded file.", 502, { uncertain: true });
      const details = await client.details(key).catch(() => null);
      uploaded.cachedBlob = payload.blobKey; uploaded.availableOffline = true;
      const stored = details?.attachments.find((file) => String(file.id) === String(uploaded.id));
      if (stored) { stored.cachedBlob = payload.blobKey; stored.availableOffline = true; }
      return { itemAlias: String(uploaded.id), attachment: uploaded, details };
    } else if (op.type === "attachment-delete") {
      try { await client.removeAttachment(key, this.itemId(payload.attachmentId)); } catch (error) { if (error.status !== 404) throw error; }
      return { attachmentRemoval: this.itemId(payload.attachmentId), details: await client.details(key).catch(() => null) };
    }
  }
  async synchronize(client) {
    await this.load(); await client.verify();
    const blocked = new Set();
    const batch = [...this.state.queue];
    let attempted = 0;
    for (const candidate of batch) {
      if (attempted >= 20) break;
      const op = await this.run(async () => {
        const current = this.state.queue.find((entry) => entry.id === candidate.id);
        if (!current) return null;
        const key = this.resolve(current.key);
        if (["conflict", "failed"].includes(current.status) || blocked.has(key)) { blocked.add(key); return null; }
        current.wasUncertain = current.status === "uncertain";
        current.status = "sending"; await this.save(); return copy(current);
      });
      if (!op) continue;
      attempted++;
      try {
        const result = await this.execute(op, client) || {};
        await this.run(async () => {
          if (result.createdKey) { this.state.aliases[op.key] = result.createdKey; this.state.recentCreates[result.createdKey] = this.now(); }
          if (result.createdKey && this.state.details[op.key]) { this.state.details[result.createdKey] = this.state.details[op.key]; delete this.state.details[op.key]; }
          const key = this.resolve(op.key);
          if (result.issue) this.state.issues[result.issue.key] = result.issue;
          if (result.itemAlias) this.state.itemAliases[`local:${op.id}`] = result.itemAlias;
          const activity = this.state.details[key] || { comments: [], attachments: [], links: [], linkTypes: this.profile.metadata.linkTypes || [], attachmentSettings: this.profile.metadata.attachmentSettings || {}, cached: false };
          if (result.comment) activity.comments = [...activity.comments.filter((comment) => String(comment.id) !== String(result.comment.id)), result.comment];
          if (result.commentRemoval) activity.comments = activity.comments.filter((comment) => String(comment.id) !== result.commentRemoval);
          if (result.attachment) activity.attachments = [...activity.attachments.filter((file) => String(file.id) !== String(result.attachment.id)), result.attachment];
          if (result.attachmentRemoval) activity.attachments = activity.attachments.filter((file) => String(file.id) !== result.attachmentRemoval);
          if (result.linkRemoval) activity.links = activity.links.filter((link) => String(link.id) !== result.linkRemoval);
          if (op.type.includes("-")) this.state.details[key] = activity;
          if (result.details) this.cacheDetails(this.resolve(op.key), result.details);
          if (result.deletedKey) { this.state.deletedKeys.push(key); delete this.state.issues[key]; delete this.state.details[key]; }
          this.state.queue = this.state.queue.filter((entry) => entry.id !== op.id); await this.save();
        });
      } catch (error) {
        await this.run(async () => {
          const current = this.state.queue.find((entry) => entry.id === op.id);
          if (!current) return;
          current.status = error.uncertain ? "uncertain" : error.conflicts || error.status === 409 ? "conflict" : retryable(error) || error.dependency ? "pending" : "failed";
          current.error = error.message; current.conflicts = error.conflicts || []; current.remoteBase = error.remoteBase;
          if (error.partialIssue) this.state.issues[error.partialIssue.key] = error.partialIssue;
          await this.save(); blocked.add(this.resolve(op.key));
        });
        if (retryable(error)) throw error;
      }
    }
    const snapshot = await client.snapshot();
    await this.run(async () => {
      const found = new Set(snapshot.issues.map((issue) => issue.key));
      for (const issue of snapshot.issues) if (!this.state.deletedKeys.includes(issue.key)) this.state.issues[issue.key] = issue;
      for (const key of Object.keys(this.state.issues)) if (!found.has(key) && !this.pending(key).length && (!this.state.recentCreates[key] || Date.parse(this.now()) - Date.parse(this.state.recentCreates[key]) > 120000)) delete this.state.issues[key];
      this.state.profile.metadata = copy(client.metadata); this.state.lastSyncedAt = this.now(); await this.save();
    });
    const warmed = new Set(), count = snapshot.issues.length;
    const start = (this.warmCursor || 0) % (count || 1);
    const warmIssues = [...snapshot.issues.slice(start), ...snapshot.issues.slice(0, start)].slice(0, 20);
    this.warmCursor = (start + warmIssues.length) % (count || 1);
    for (const issue of warmIssues) {
      if (!this.state.editContexts[issue.key]) {
        try { const context = await client.editContext(issue.key); await this.run(async () => { this.state.editContexts[issue.key] = context; await this.save(); }); }
        catch (error) { if (retryable(error)) throw error; }
      }
      if (!this.state.details[issue.key]) {
        try { const details = await client.details(issue.key); await this.run(async () => { this.cacheDetails(issue.key, details); await this.save(); warmed.add(issue.key); }); }
        catch (error) { if (retryable(error)) throw error; }
      }
    }
    const commentStart = (this.commentCursor || 0) % (count || 1);
    const refreshComments = [...snapshot.issues.slice(commentStart), ...snapshot.issues.slice(0, commentStart)].slice(0, 5);
    this.commentCursor = (commentStart + refreshComments.length) % (count || 1);
    for (const issue of refreshComments) if (!warmed.has(issue.key) && this.state.details[issue.key]) {
      try {
        const comments = await client.comments(issue.key);
        await this.run(async () => {
          const details = this.state.details[issue.key];
          if (details && !equal(details.comments, comments)) { details.comments = comments; await this.save(); }
        });
      } catch (error) { if (retryable(error)) throw error; }
    }
    return this.snapshot();
  }
}
