import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JiraConnection } from "../local/jira-connection.mjs";
import { workspaceStore } from "../local/jira-store.mjs";
import { jiraCacheChanges } from "../lib/jira-cache-changes.mjs";
import { adfText } from "../lib/jira-fields.mjs";
import { jiraFixture, accountId } from "./jira-fixture.mjs";

const payload = (summary = "Offline task", extra = {}) => ({ requestId: randomUUID(), projectId: "10001", issueTypeId: "task", fields: { summary }, ...extra });
const count = (fixture, method, endpoint) => fixture.calls.filter((call) => call.method === method && call.path === endpoint).length;
async function setup() {
  const fixture = jiraFixture();
  const workspace = fixture.makeWorkspace();
  const client = await fixture.makeClient().initialise();
  await workspace.run(() => workspace.prime(client));
  await workspace.synchronize(client);
  return { ...fixture, fixture, workspace, client };
}
const connection = (fixture) => new JiraConnection({ workspace: fixture.makeWorkspace(), createClient: fixture.makeClient, loadToken: async () => ({ token: "fake-test-token", source: "fixture" }), autoSync: false });

test("offline parent and subtasks survive restart and sync once with self-assignment and Medium", async () => {
  const { fixture, workspace } = await setup();
  const request = payload("Offline parent", { subtasks: [payload("First child"), payload("Second child")] });
  const result = await workspace.create(request, null);
  assert.equal(result.pending, true);
  assert.equal(result.issue.fields.assignee.accountId, accountId);
  assert.equal(result.issue.fields.priority.name, "Medium");
  assert.equal(workspace.children(result.key).length, 2);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue"), 0);
  const restarted = fixture.makeWorkspace(); await restarted.load();
  assert.equal(restarted.queueSummary().pending, 3);
  await restarted.synchronize(await fixture.makeClient().initialise());
  const key = restarted.resolve(result.key), parent = fixture.issues.get(key);
  assert.equal(parent.fields.summary, "Offline parent");
  assert.equal(parent.fields.assignee.accountId, accountId);
  assert.equal(parent.fields.priority.name, "Medium");
  assert.equal(restarted.children(key).length, 2);
  assert.ok(restarted.children(key).every((child) => fixture.issues.get(child.key).fields.parent.key === key));
  assert.equal(restarted.queueSummary().pending, 0);
  await restarted.create(request, null);
  await restarted.synchronize(await fixture.makeClient().initialise());
  assert.equal(count(fixture, "POST", "/rest/api/3/issue"), 3);
  await assert.rejects(() => restarted.create({ ...request, fields: { summary: "Changed retry" } }, null), /different details/);
});

test("invalid subtask rolls back the whole local batch without leaving a partial parent", async () => {
  const { workspace } = await setup();
  await assert.rejects(() => workspace.create(payload("Parent", { subtasks: [payload("")] }), null), /summary is required/);
  assert.equal(workspace.queueSummary().pending, 0);
  assert.equal(workspace.snapshot().issues.length, 2);
});

test("adding a subtask from an existing parent uses creation metadata, and inline renames survive offline restart", async () => {
  const { workspace, fixture } = await setup();
  const parent = await workspace.editContext("KAN-1");
  assert.equal(parent.issueType, undefined); // Edit metadata has no creation-only issue type.
  const creation = await workspace.createContext({ parentKey: parent.issue.key });
  assert.equal(creation.issueType.subtask, true);
  const created = await workspace.create({ requestId: randomUUID(), parentKey: parent.issue.key, fields: { summary: "Child from parent details" } });
  assert.equal(created.issue.fields.parent.key, "KAN-1");
  assert.equal(created.issue.fields.priority.name, "Medium");
  await workspace.update(created.key, { fields: { summary: "Renamed in parent" }, baseFields: { summary: "Child from parent details" } });
  await workspace.update(created.key, { fields: { summary: "Latest inline title" }, baseFields: { summary: "Renamed in parent" } });
  const restarted = fixture.makeWorkspace(); await restarted.load();
  assert.equal(restarted.children("KAN-1")[0].summary, "Latest inline title");
  await restarted.synchronize(await fixture.makeClient().initialise());
  const child = fixture.issues.get(restarted.resolve(created.key));
  assert.equal(child.fields.summary, "Latest inline title");
  assert.equal(child.fields.parent.key, "KAN-1");
  assert.equal(child.fields.assignee.accountId, accountId);
  assert.equal(restarted.queueSummary().pending, 0);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue"), 1);
});

test("offline edits replay in order and merge unrelated changes made in Jira", async () => {
  const { workspace, client, fixture } = await setup();
  await workspace.update("KAN-1", { fields: { summary: "First local edit" } });
  await workspace.update("KAN-1", { fields: { summary: "Second local edit" } });
  fixture.issues.get("KAN-1").fields.description = { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Remote description" }] }] };
  await workspace.synchronize(client);
  assert.equal(workspace.queueSummary().pending, 0);
  assert.equal(fixture.issues.get("KAN-1").fields.summary, "Second local edit");
  assert.equal(adfText(fixture.issues.get("KAN-1").fields.description).trim(), "Remote description");
  assert.equal(fixture.issues.get("KAN-1").fields.assignee.accountId, accountId);
});

test("conflicting edits require review and confirmed retry preserves other remote fields", async () => {
  const { workspace, client, fixture } = await setup();
  await workspace.update("KAN-1", { fields: { summary: "Local version" } });
  fixture.issues.get("KAN-1").fields.summary = "Remote version";
  fixture.issues.get("KAN-1").fields.labels = ["remote-label"];
  await workspace.synchronize(client);
  const entry = workspace.queueSummary().entries[0];
  assert.equal(entry.status, "conflict"); assert.equal(entry.conflicts[0].remote, "Remote version");
  assert.equal(fixture.issues.get("KAN-1").fields.summary, "Remote version");
  await assert.rejects(() => workspace.retry(entry.id, false, client), /confirm/);
  await workspace.retry(entry.id, true, client); await workspace.synchronize(client);
  assert.equal(workspace.queueSummary().pending, 0);
  assert.equal(fixture.issues.get("KAN-1").fields.summary, "Local version");
  assert.deepEqual(fixture.issues.get("KAN-1").fields.labels, ["remote-label"]);
});

test("lost creation response reconciles its Jira property after restart without another POST", async () => {
  const { workspace, client, fixture } = await setup();
  const request = payload(); await workspace.create(request, null);
  fixture.afterFaults.set("POST /rest/api/3/issue", true);
  await assert.rejects(() => workspace.synchronize(client));
  assert.equal(workspace.queueSummary().entries[0].status, "uncertain");
  const restarted = fixture.makeWorkspace();
  await restarted.synchronize(await fixture.makeClient().initialise());
  assert.equal(restarted.queueSummary().pending, 0);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue"), 1);
  assert.match(restarted.resolve(`local:${request.requestId}`), /^KAN-/);
});

test("recovery after a crash before a creation receipt is saved never blindly repeats a create", async () => {
  const { workspace, client, fixture } = await setup();
  await workspace.create(payload(), null);
  workspace.state.queue[0].status = "sending"; await workspace.save();
  const restarted = fixture.makeWorkspace();
  await restarted.synchronize(client);
  assert.equal(restarted.queueSummary().entries[0].status, "uncertain");
  assert.equal(count(fixture, "POST", "/rest/api/3/issue"), 0);
});

test("offline comments can be edited, recovered after lost response, then deleted", async () => {
  const { workspace, client, fixture } = await setup();
  const id = randomUUID();
  await workspace.activity("comment-add", "KAN-1", { operationId: id, body: "Offline comment" });
  await workspace.activity("comment-edit", "KAN-1", { commentId: `local:${id}`, body: "Edited offline" });
  assert.equal(adfText(workspace.detailsView("KAN-1").comments[0].body).trim(), "Edited offline");
  fixture.afterFaults.set("POST /rest/api/3/issue/KAN-1/comment", true);
  await assert.rejects(() => workspace.synchronize(client));
  const restarted = fixture.makeWorkspace(); await restarted.synchronize(await fixture.makeClient().initialise());
  assert.equal(restarted.queueSummary().pending, 0);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue/KAN-1/comment"), 1);
  assert.equal(adfText(fixture.comments.get("KAN-1")[0].body).trim(), "Edited offline");
  const comment = restarted.detailsView("KAN-1").comments[0];
  await restarted.activity("comment-delete", "KAN-1", { commentId: comment.id, confirmDelete: true });
  await restarted.synchronize(client);
  assert.equal(fixture.comments.get("KAN-1").length, 0);
});

test("files are durable offline and a lost upload response is recovered by content hash", async () => {
  const { workspace, client, fixture } = await setup();
  const id = randomUUID(), data = Buffer.from("Offline attachment verification\n");
  await workspace.attach("KAN-1", { operationId: id, filename: "offline-test.txt", mimeType: "text/plain", data: data.toString("base64") });
  assert.equal((await workspace.attachment("KAN-1", `local:${id}`, null)).data, data.toString("base64"));
  fixture.afterFaults.set("POST /rest/api/3/issue/KAN-1/attachments", true);
  await assert.rejects(() => workspace.synchronize(client));
  const restarted = fixture.makeWorkspace(); await restarted.synchronize(await fixture.makeClient().initialise());
  assert.equal(restarted.queueSummary().pending, 0);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue/KAN-1/attachments"), 1);
  const file = restarted.detailsView("KAN-1").attachments[0];
  fixture.state.offline = true;
  assert.equal((await restarted.attachment("KAN-1", file.id, null)).data, data.toString("base64"));
  assert.equal((await restarted.attachment("KAN-1", `local:${id}`, null)).data, data.toString("base64"));
});

test("cached Jira files remain available after restart; uncached files clearly need a connection", async () => {
  const { workspace, client, fixture } = await setup();
  fixture.issues.get("KAN-1").fields.attachment.push({ id: "999", filename: "remote.txt", size: 6, mimeType: "text/plain" });
  fixture.files.set("999", Buffer.from("Remote"));
  await workspace.details("KAN-1", client);
  await assert.rejects(() => workspace.attachment("KAN-1", "999", null), /not cached/);
  await workspace.attachment("KAN-1", "999", client);
  const restarted = fixture.makeWorkspace(); await restarted.load();
  assert.equal(Buffer.from((await restarted.attachment("KAN-1", "999", null)).data, "base64").toString(), "Remote");
});

test("issue links can target queued tasks and remain single after response loss", async () => {
  const { workspace, client, fixture } = await setup();
  const draft = await workspace.create(payload("Link target"), null);
  await workspace.activity("link-add", "KAN-1", { targetKey: draft.key, typeId: "1", direction: "outward" });
  fixture.afterFaults.set("POST /rest/api/3/issueLink", true);
  await assert.rejects(() => workspace.synchronize(client));
  await workspace.synchronize(client);
  assert.equal(workspace.queueSummary().pending, 0);
  assert.equal(fixture.issues.get("KAN-1").fields.issuelinks.length, 1);
  const link = workspace.detailsView("KAN-1").links[0];
  await workspace.activity("link-delete", "KAN-1", { linkId: link.id, confirmDelete: true });
  await workspace.synchronize(client);
  assert.equal(fixture.issues.get("KAN-1").fields.issuelinks.length, 0);
});

test("draft parent deletion never silently deletes unselected subtasks", async () => {
  const { workspace } = await setup();
  const parent = await workspace.create(payload("Parent", { subtasks: [payload("Child")] }), null);
  await assert.rejects(() => workspace.remove(parent.key), /subtasks/);
  const child = workspace.children(parent.key)[0];
  await workspace.remove(child.key); await workspace.remove(parent.key);
  assert.equal(workspace.queueSummary().pending, 0);
  assert.equal(workspace.snapshot().issues.length, 2);
});

test("a pending delete stays visible in the sync queue and conflicts instead of deleting a changed task", async () => {
  const { workspace, client, fixture } = await setup();
  await workspace.remove("KAN-1");
  assert.equal(workspace.viewIssue("KAN-1").syncDeleted, true);
  assert.equal(workspace.queueSummary().entries[0].type, "delete");
  fixture.issues.get("KAN-1").fields.summary = "Edited before delete";
  await workspace.synchronize(client);
  assert.equal(workspace.queueSummary().entries[0].status, "conflict");
  assert.equal(fixture.issues.has("KAN-1"), true);
  await workspace.retry(workspace.queueSummary().entries[0].id, true, client);
  await workspace.synchronize(client);
  assert.equal(fixture.issues.has("KAN-1"), false);
  assert.ok(workspace.snapshot().deletedKeys.includes("KAN-1"));
});

test("sync network requests do not hold the local write lock", async () => {
  const { workspace, client, fixture } = await setup();
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const sending = new Promise((resolve) => { started = resolve; });
  fixture.state.pause = async ({ method, path }) => { if (method === "POST" && path === "/rest/api/3/issue") { started(); await gate; } };
  await workspace.run(() => workspace.create(payload("First"), null));
  const syncing = workspace.synchronize(client); await sending;
  await workspace.run(() => workspace.create(payload("Second"), null));
  assert.equal(workspace.queueSummary().pending, 2);
  release(); await syncing; fixture.state.pause = null; await workspace.synchronize(client);
  assert.equal(workspace.queueSummary().pending, 0);
});

test("connection works offline after restart and automatically reconnects and flushes later", async () => {
  const fixture = jiraFixture(); const broker = connection(fixture);
  await broker.connect(); await broker.tick();
  fixture.state.offline = true; await broker.tick();
  assert.equal(broker.publicStatus().phase, "offline");
  await broker.command("create", payload());
  const restarted = connection(fixture); await restarted.connect();
  assert.equal(restarted.publicStatus().availableOffline, true);
  assert.equal(restarted.publicStatus().queue.pending, 1);
  fixture.state.offline = false; await restarted.tick();
  assert.equal(restarted.publicStatus().connected, true);
  assert.equal(restarted.publicStatus().queue.pending, 0);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue"), 1);
});

test("more than twenty blocked changes cannot starve an unrelated task", async () => {
  const { workspace, client, fixture } = await setup();
  for (let i = 0; i < 21; i++) await workspace.update("KAN-1", { fields: { summary: `Edit ${i}` } });
  workspace.state.queue.forEach((op) => { op.status = "failed"; });
  await workspace.update("KAN-2", { fields: { summary: "Independent edit" } });
  await workspace.synchronize(client);
  assert.equal(fixture.issues.get("KAN-2").fields.summary, "Independent edit");
});

test("disk workspace is private, persistent and refuses corrupt state without overwriting it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jira-workspace-test-"));
  try {
    const store = workspaceStore(directory), value = { queue: [{ body: "Saved change" }] }, blobKey = `file-${randomUUID()}`;
    await store.writeState(value); await store.writeBlob(blobKey, Buffer.from("File"));
    assert.deepEqual(await workspaceStore(directory).readState(), value);
    assert.equal((await stat(path.join(directory, "workspace-v1.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(directory, "attachments", blobKey))).mode & 0o777, 0o600);
    assert.throws(() => store.writeBlob("../outside", Buffer.from("x")), /Invalid/);
    await writeFile(path.join(directory, "workspace-v1.json"), "bad-json");
    await assert.rejects(() => store.readState(), /kept/);
    assert.equal(await readFile(path.join(directory, "workspace-v1.json"), "utf8"), "bad-json");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("temporary-to-Jira key mapping preserves task ID, private notes, reminder and history", () => {
  const db = new DatabaseSync(":memory:"), key = `local:${randomUUID()}`;
  try {
    db.exec("CREATE TABLE tasks (id INTEGER PRIMARY KEY, jira_key TEXT UNIQUE, source TEXT, notes TEXT, notify_at TEXT, jira_parent_key TEXT); CREATE TABLE task_updates (task_id INTEGER, body TEXT); CREATE TABLE jira_task_aliases (local_key TEXT PRIMARY KEY, jira_key TEXT); CREATE TABLE jira_deleted_tasks (jira_key TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO tasks VALUES (1, ?, 'jira', 'Private note', '2030-01-01', NULL)").run(key);
    db.exec("INSERT INTO tasks VALUES (2, 'KAN-11', 'jira', '', NULL, NULL); INSERT INTO task_updates VALUES (1, 'Local history'), (2, 'Imported history')");
    for (const statement of jiraCacheChanges({ [key]: "KAN-11" })) db.prepare(statement.sql).run(...statement.params);
    const task = db.prepare("SELECT * FROM tasks").get();
    assert.equal(task.id, 1); assert.equal(task.jira_key, "KAN-11"); assert.equal(task.notes, "Private note"); assert.equal(task.notify_at, "2030-01-01");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_updates WHERE task_id = 1").get().count, 2);
    for (const statement of jiraCacheChanges({}, ["KAN-11"])) db.prepare(statement.sql).run(...statement.params);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_updates").get().count, 0);
    assert.equal(db.prepare("SELECT jira_key FROM jira_deleted_tasks").get().jira_key, "KAN-11");
  } finally { db.close(); }
});

test("replaying an already-synced comment or upload request does not duplicate it", async () => {
  const { workspace, client, fixture } = await setup();
  const comment = { operationId: randomUUID(), body: "Retryable comment" };
  const attachment = { operationId: randomUUID(), filename: "retry.txt", data: Buffer.from("Same file").toString("base64") };
  await workspace.activity("comment-add", "KAN-1", comment); await workspace.attach("KAN-1", attachment);
  await workspace.synchronize(client);
  await workspace.activity("comment-add", "KAN-1", comment); await workspace.attach("KAN-1", attachment);
  await workspace.synchronize(client);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue/KAN-1/comment"), 1);
  assert.equal(count(fixture, "POST", "/rest/api/3/issue/KAN-1/attachments"), 1);
  await assert.rejects(() => workspace.activity("comment-add", "KAN-1", { ...comment, body: "Different comment" }), /different details/);
  await assert.rejects(() => workspace.attach("KAN-1", { ...attachment, data: Buffer.from("Different file").toString("base64") }), /different file/);
});

test("a discarded local attachment removes its staged private file", async () => {
  const { workspace, fixture } = await setup();
  const operationId = randomUUID();
  await workspace.attach("KAN-1", { operationId, filename: "discard.txt", data: Buffer.from("discard").toString("base64") });
  assert.equal(fixture.blobs.size, 1);
  await workspace.discard(operationId, true);
  assert.equal(fixture.blobs.size, 0);
  assert.equal(workspace.detailsView("KAN-1").attachments.length, 0);
});

test("card comment context reflects offline additions, edits and deletions after a restart", async () => {
  const { workspace, fixture } = await setup();
  const operationId = randomUUID();
  await workspace.activity("comment-add", "KAN-1", { operationId, body: "Comment shown on card" });
  assert.equal(workspace.snapshot().issues.find((issue) => issue.key === "KAN-1").cachedComments[0].body, "Comment shown on card");
  await workspace.activity("comment-edit", "KAN-1", { commentId: `local:${operationId}`, body: "Edited card context" });
  const restarted = fixture.makeWorkspace(); await restarted.load();
  const comment = restarted.snapshot().issues.find((issue) => issue.key === "KAN-1").cachedComments[0];
  assert.equal(comment.body, "Edited card context"); assert.equal(comment.pending, true); assert.equal(comment.author, "Anit");
  await restarted.activity("comment-delete", "KAN-1", { commentId: `local:${operationId}`, confirmDelete: true });
  assert.equal(restarted.viewIssue("KAN-1").cachedComments.length, 0);
});

test("background Jira sync refreshes comment previews without opening task details", async () => {
  const { workspace, fixture, client } = await setup();
  fixture.comments.set("KAN-1", [{ id: "500", body: "External Jira comment", author: { displayName: "Anit", accountId }, created: "2026-10-16T10:00:00Z", updated: "2026-10-16T10:00:00Z" }]);
  await workspace.synchronize(client);
  assert.equal(workspace.viewIssue("KAN-1").cachedComments[0].body, "External Jira comment");
  fixture.comments.set("KAN-1", []); await workspace.synchronize(client);
  assert.equal(workspace.viewIssue("KAN-1").cachedComments.length, 0);
});

test("recent card comments compare actual times across Jira timezone offsets and offline UTC timestamps", async () => {
  const { workspace } = await setup();
  workspace.now = () => "2026-10-16T03:00:00Z";
  workspace.state.details['KAN-1'].comments = [
    { id: '201', body: 'Jira comment in India time', author: { displayName: 'Anit' }, created: '2026-10-16T08:20:00+0530', updated: '2026-10-16T08:20:00+0530' },
    { id: '200', body: 'Earlier UTC comment', author: { displayName: 'Anit' }, created: '2026-10-16T02:00:00Z', updated: '2026-10-16T02:00:00Z' },
  ];
  await workspace.activity('comment-add', 'KAN-1', { body: 'Newest offline comment' });
  assert.deepEqual(workspace.viewIssue('KAN-1').cachedComments.map(comment => comment.body), ['Newest offline comment', 'Jira comment in India time', 'Earlier UTC comment']);
});


test("opening cached task fields and activity performs no Jira requests, including after a restart", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.editContext("KAN-1", client);
  const broker = connection(fixture); await broker.connect();
  const before = fixture.calls.length;
  const [context, activity] = await Promise.all([broker.command("edit-meta", { key: "KAN-1" }), broker.command("details", { key: "KAN-1" })]);
  assert.equal(fixture.calls.length, before);
  assert.equal(context.issue.fields.summary, "Task 1");
  assert.ok(context.fields.some(field => field.fieldId === "summary"));
  assert.ok(Array.isArray(activity.details.comments));
  assert.ok(context.editorSchemas["10001:task"].some(field => field.fieldId === "summary"));
  assert.ok(Object.values(context.editorSchemas).flat().every(field => ["summary", "description", "priority", "duedate", "parent", "labels"].includes(field.fieldId)));
  assert.equal(context.offline, false);
});

test("a slow background field refresh never blocks cached reads or edits, and cannot overwrite a new draft", async () => {
  const { fixture } = await setup();
  const broker = connection(fixture); await broker.connect();
  let release;
  const started = Promise.withResolvers();
  const blocked = new Promise(resolve => { release = resolve; });
  fixture.state.pause = async ({ path }) => { if (path.endsWith("/editmeta")) { started.resolve(); await blocked; } };
  const refreshing = broker.command("edit-meta", { key: "KAN-1", refresh: true });
  await started.promise;
  let timer;
  try {
    const action = Promise.all([
      broker.command("edit-meta", { key: "KAN-1" }),
      broker.command("update", { key: "KAN-1", fields: { summary: "Typing while Jira refreshes" } }),
    ]);
    const result = await Promise.race([action, new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); })]);
    assert.ok(result, "A local edit must not wait for a network metadata read");
  } finally { clearTimeout(timer); release(); }
  const refreshed = await refreshing;
  assert.equal(refreshed.issue.fields.summary, "Typing while Jira refreshes");
  assert.equal(broker.workspace.viewIssue("KAN-1").fields.summary, "Typing while Jira refreshes");
});

test("a slow activity refresh does not block local comments or replace pending edits", async () => {
  const { fixture } = await setup();
  const broker = connection(fixture); await broker.connect();
  let release;
  const started = Promise.withResolvers(), blocked = new Promise(resolve => { release = resolve; });
  fixture.state.pause = async ({ path }) => { if (path.endsWith("/comment")) { started.resolve(); await blocked; } };
  const refreshing = broker.command("details", { key: "KAN-1", refresh: true });
  await started.promise;
  let timer;
  try {
    const result = await Promise.race([
      broker.command("comment-add", { key: "KAN-1", body: "Comment saved while refreshing", operationId: randomUUID() }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); }),
    ]);
    assert.ok(result, "Adding a local comment must not wait for live activity");
  } finally { clearTimeout(timer); release(); }
  const result = await refreshing;
  assert.ok(result.details.comments.some(comment => adfText(comment.body).includes("Comment saved while refreshing")));
});


test("legacy task metadata follows the current board workflow before any Jira refresh", async () => {
  const { fixture, workspace, client } = await setup();
  const oldContext = await workspace.editContext("KAN-1", client);
  delete workspace.state.editContexts["KAN-1"].workflowSignature; // Existing installations have no workflow version.
  const statuses = [
    { id: "10", name: "Inbox", category: "new" },
    { id: "40", name: "Now", category: "new" },
    { id: "20", name: "Parked", category: "indeterminate" },
    { id: "25", name: "Almost Done", category: "indeterminate" },
    { id: "30", name: "Done", category: "done" },
  ];
  client.metadata.columns = statuses.map((status) => ({ id: `column-${status.id}`, name: status.name, done: status.category === "done", statuses: [status] }));
  await workspace.run(() => workspace.prime(client));
  const restarted = fixture.makeWorkspace(); await restarted.load();
  const before = fixture.calls.length;
  const cached = await restarted.editContext("KAN-1");
  assert.equal(fixture.calls.length, before, "Showing current workflow buttons must not wait for Jira");
  assert.deepEqual(cached.transitions.map((transition) => transition.to), statuses);
  assert.equal(cached.issue.fields.status.id, "20");
  assert.equal(cached.issue.fields.status.name, "Parked");
  assert.deepEqual(cached.fields, oldContext.fields);
  assert.equal(restarted.state.editContexts["KAN-1"].transitions[1].to.name, "In Progress", "Reading must not mutate the saved context");
  const readContext = client.editContext.bind(client);
  client.editContext = async (key) => ({ ...await readContext(key), transitions: statuses.map((status) => ({ id: `live-${status.id}`, name: status.name, to: status, fields: [] })) });
  const fresh = await restarted.editContext("KAN-1", client);
  assert.deepEqual(fresh.transitions.map((transition) => transition.to), cached.transitions.map((transition) => transition.to));
});

test("workflow changes invalidate cached transitions while fresh permissions and required fields survive restart", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.editContext("KAN-1", client);
  client.metadata.columns[1].statuses[0].name = "Parked";
  await workspace.run(() => workspace.prime(client));
  const before = fixture.calls.length;
  const cached = await workspace.editContext("KAN-1");
  assert.equal(fixture.calls.length, before);
  assert.equal(cached.transitions[1].to.name, "Parked");
  const readContext = client.editContext.bind(client);
  const required = { fieldId: "resolution", name: "Resolution", required: true, hasDefaultValue: false, schema: { type: "string" }, allowedValues: [] };
  client.editContext = async (key) => {
    const context = await readContext(key);
    return { ...context, transitions: context.transitions.filter((transition) => transition.to.id === "30").map((transition) => ({ ...transition, fields: [required] })) };
  };
  const fresh = await workspace.editContext("KAN-1", client);
  assert.equal(fresh.transitions.length, 1, "Fresh Jira permissions must not be broadened to every board status");
  const restarted = fixture.makeWorkspace(); await restarted.load();
  const offline = await restarted.editContext("KAN-1");
  assert.deepEqual(offline.transitions, fresh.transitions);
  assert.equal(offline.transitions[0].id, "to-30");
  assert.deepEqual(offline.transitions[0].fields, [required]);
});


test("subtasks inherit queued parent priority offline, preserve overrides and sync after restart", async () => {
  const { fixture, workspace } = await setup();
  await workspace.update("KAN-1", { fields: { priority: "2" } });
  const context = await workspace.createContext({ parentKey: "KAN-1" });
  assert.equal(context.fields.find((field) => field.fieldId === "priority").defaultValue.id, "2");
  assert.equal((await workspace.createContext({ projectId: "10001" })).fields.find((field) => field.fieldId === "priority").defaultValue.id, "3", "Parent defaults must not leak into other tasks");
  const child = await workspace.create(payload("Inherited child", { parentKey: "KAN-1" }));
  assert.equal(child.issue.fields.priority.name, "High");
  const explicit = await workspace.create(payload("Override child", { parentKey: "KAN-1", fields: { summary: "Override child", priority: "3" } }));
  assert.equal(explicit.issue.fields.priority.name, "Medium");
  const batch = await workspace.create(payload("New high parent", { fields: { summary: "New high parent", priority: "2" }, subtasks: [payload("Batch inherited"), payload("Batch override", { fields: { summary: "Batch override", priority: "3" } })] }));
  const children = workspace.children(batch.key).map((row) => workspace.viewIssue(row.key));
  assert.deepEqual(children.map((row) => row.fields.priority.name), ["High", "Medium"]);
  // Later parent changes do not retroactively overwrite a child's chosen priority.
  await workspace.update("KAN-1", { fields: { priority: "3" } });
  const restarted = fixture.makeWorkspace(); await restarted.load();
  await restarted.synchronize(await fixture.makeClient().initialise());
  assert.equal(restarted.queueSummary().pending, 0);
  assert.equal(fixture.issues.get(restarted.resolve(child.key)).fields.priority.name, "High");
  assert.equal(fixture.issues.get(restarted.resolve(explicit.key)).fields.priority.name, "Medium");
  assert.deepEqual(children.map((row) => fixture.issues.get(restarted.resolve(row.key)).fields.priority.name), ["High", "Medium"]);
});
