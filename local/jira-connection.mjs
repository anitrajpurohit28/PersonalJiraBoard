import { configurationId, configuredBoardId, helperProtocolVersion, settings } from "../config/settings.mjs";
import { JiraApi } from "./jira-api.mjs";
import { JiraWorkspace } from "./jira-workspace.mjs";
import { loadApiToken, saveApiToken, validateApiToken } from "./jira-credentials.mjs";
import { CORE_JIRA_FIELDS, jiraError } from "../lib/jira-fields.mjs";

export class JiraConnection {
  constructor({ loadToken = loadApiToken, saveToken = saveApiToken, createClient = (token) => new JiraApi(token), workspace = new JiraWorkspace(), autoSync = true } = {}) {
    this.loadToken = loadToken; this.saveToken = saveToken; this.createClient = createClient; this.workspace = workspace; this.autoSync = autoSync;
    this.client = null; this.bootChecked = false; this.hasCredential = false; this.credentialSource = null;
    this.connecting = null; this.syncing = null; this.generation = 0; this.paused = false;
    this.phase = "disconnected"; this.message = "Connect Jira once to enable offline tasks and automatic sync.";
  }
  publicStatus() {
    const profile = this.workspace.profile;
    return {
      protocolVersion: helperProtocolVersion, configId: configurationId,
      connected: Boolean(this.client) && this.phase === "connected", availableOffline: this.workspace.available,
      phase: this.phase, message: this.message, paused: this.paused, syncing: Boolean(this.syncing),
      account: profile?.identity.emailAddress || this.client?.identity?.emailAddress || null,
      accountId: profile?.identity.accountId || this.client?.identity?.accountId || null,
      accountDisplayName: profile?.identity.displayName || null,
      baseUrl: profile?.baseUrl || this.client?.baseUrl || null, cloudId: profile?.cloudId || this.client?.cloudId || null,
      boardId: configuredBoardId, metadata: profile?.metadata || null,
      editorSchemas: Object.fromEntries(Object.entries(this.workspace.state.createContexts).map(([key, context]) => [key, context.fields.filter((field) => CORE_JIRA_FIELDS.includes(field.fieldId))])),
      hasCredential: this.hasCredential, credentialSource: this.credentialSource, queue: this.workspace.queueSummary(),
    };
  }
  async status() {
    await this.workspace.load();
    if (!this.bootChecked) {
      this.bootChecked = true;
      try {
        const saved = await this.loadToken(); this.hasCredential = Boolean(saved); this.credentialSource = saved?.source || null;
        if (saved) void this.connect().catch(() => {});
      } catch (error) { this.phase = "error"; this.message = error.message; }
    }
    return this.publicStatus();
  }
  kick() {
    if (!this.autoSync || this.paused) return;
    const timer = setTimeout(() => { void this.tick().catch(() => {}); }, 0); timer.unref?.();
  }
  async connect(payload = {}) {
    if (this.connecting) return this.connecting;
    this.bootChecked = true; this.paused = false;
    const generation = ++this.generation;
    this.phase = "connecting"; this.message = "Connecting to Jira…";
    this.connecting = (async () => {
      await this.workspace.load();
      const saved = payload.apiToken ? { token: validateApiToken(payload.apiToken), source: "entered for this session" } : await this.loadToken();
      if (!saved) throw jiraError("Add your Jira API token to config/credentials.json or enter it in Connect Jira.", 401);
      const client = this.createClient(saved.token); await client.initialise();
      if (generation !== this.generation) throw jiraError("The Jira connection was cancelled.", 409);
      if (payload.apiToken && payload.remember === true) { await this.saveToken(saved.token); saved.source = "saved on this device"; }
      await this.workspace.run(() => this.workspace.prime(client));
      if (generation !== this.generation) throw jiraError("The Jira connection was cancelled.", 409);
      if (this.client) this.client.active = false;
      this.client = client; this.hasCredential = true; this.credentialSource = saved.source;
      this.phase = "connected"; this.message = "Jira connected. Changes sync automatically.";
      this.kick(); return this.publicStatus();
    })().catch((error) => {
      if (generation === this.generation) {
        this.phase = this.workspace.available ? "offline" : "error";
        this.message = error.status === 401 || error.status === 403 ? error.message : this.workspace.available ? "Offline. Changes are saved here and will sync when Jira is reachable." : error.message;
        if (error.status === 401 || /only accepts/.test(error.message)) { this.phase = "error"; this.paused = true; }
      }
      if (!this.workspace.available) throw error;
      return this.publicStatus();
    }).finally(() => { if (generation === this.generation) this.connecting = null; });
    return this.connecting;
  }
  disconnect() {
    this.generation++; this.paused = true; this.bootChecked = true;
    if (this.client) { this.client.active = false; this.client.authorization = ""; }
    this.client = null; this.connecting = null;
    this.phase = "paused"; this.message = "Sync paused. You can work offline; reconnect Jira to upload your saved changes.";
    return this.publicStatus();
  }
  async tick() {
    if (this.paused || this.connecting || this.syncing) return;
    if (!this.bootChecked) await this.status();
    if (this.connecting) return;
    if (!this.client || this.phase !== "connected") {
      await this.connect();
      if (!this.client || this.phase !== "connected") return;
    }
    const client = this.client;
    this.syncing = this.workspace.synchronize(client).then(() => {
      if (client === this.client) { this.phase = "connected"; this.message = "Jira connected. Changes sync automatically."; }
    }).catch((error) => {
      if (client === this.client) {
        this.phase = "offline"; this.message = "Offline. Changes are saved here and will sync when Jira is reachable.";
        if (error.status === 401 || /only accepts/.test(error.message)) { this.paused = true; this.phase = "error"; this.message = error.message; }
      }
    }).finally(() => { this.syncing = null; });
    await this.syncing;
  }
  async command(action, payload = {}) {
    await this.workspace.load();
    if (action === "queue") return { ...this.publicStatus(), ...this.workspace.snapshot() };
    if (!this.workspace.available) {
      if (this.connecting) await this.connecting;
      if (!this.workspace.available) throw jiraError(`Connect Jira as ${settings.email} once before working offline.`, 503);
    }
    const client = this.phase === "connected" && !this.paused ? this.client : null;
    let result;
    const queuedBefore = this.workspace.state.queue.length;
    if (action === "issues") { if (payload.refresh === true) this.kick(); result = this.workspace.snapshot(); }
    else if (action === "edit-meta") {
      // Cached reads never wait for Jira or hold the local mutation queue.
      result = { ...await this.workspace.editContext(payload.key, payload.refresh === true ? client : null), offline: !client };
    }
    else if (action === "details") {
      result = { details: await this.workspace.details(payload.key, payload.refresh === true ? client : null) };
    }
    else result = await this.workspace.run(async () => {
      if (action === "areas-init") { await this.workspace.initializeAreas(payload); return {}; }
      if (action === "areas-assign") { await this.workspace.assignArea(payload); return {}; }
      if (action === "tags-init") { await this.workspace.initializeTags(payload); await this.workspace.discoverTags(); return {}; }
      if (action === "tags-upsert") { await this.workspace.saveTag(payload); return {}; }
      if (action === "tags-delete") { await this.workspace.deleteTag(payload.tagId); return {}; }
      if (action === "tags-assign") { await this.workspace.assignTag(payload); return {}; }
      if (action === "create-meta") return this.workspace.createContext(payload, client);
      if (action === "create") return this.workspace.create(payload, client);
      if (action === "update") return this.workspace.update(payload.key, payload);
      if (action === "delete") {
        if (payload.confirmDelete !== true) throw jiraError("Confirm deleting this task first.");
        return this.workspace.remove(payload.key);
      }
      if (action === "bulk") {
        if (!["done", "delete"].includes(payload.action) || !Array.isArray(payload.keys) || !payload.keys.length) throw jiraError("Invalid bulk selection.");
        if (payload.action === "delete" && payload.confirmDelete !== true) throw jiraError("Confirm deleting the selected tasks first.");
        const succeeded = [], failed = [];
        for (const key of payload.keys) {
          try { const result = payload.action === "delete" ? await this.workspace.remove(key) : await this.workspace.update(key, { action: "done" }); succeeded.push({ ...result, key }); }
          catch (error) { failed.push({ key, error: error.message }); }
        }
        return { succeeded, failed, pending: true };
      }
      if (["comment-add", "comment-edit", "comment-delete", "link-add", "link-delete", "attachment-delete"].includes(action)) return { details: await this.workspace.activity(action, payload.key, payload), pending: true };
      if (action === "attachment-add") return { details: await this.workspace.attach(payload.key, payload), pending: true };
      if (action === "attachment-content") return this.workspace.attachment(payload.key, payload.id, client);
      if (action === "queue-retry") { await this.workspace.retry(payload.id, payload.confirm === true, client); return {}; }
      if (action === "queue-discard") return this.workspace.discard(payload.id, payload.confirm === true);
      throw jiraError("Unknown Jira action.", 404);
    });
    if (["tags-init", "areas-init"].includes(action) ? this.workspace.state.queue.length > queuedBefore : !["issues", "create-meta", "edit-meta", "attachment-content", "details"].includes(action)) this.kick();
    return { ...this.publicStatus(), ...this.workspace.snapshot(), ...result };
  }
}
