import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { JiraConnection } from "../local/jira-connection.mjs";
import { findAreaField, readAreaCatalog, issueAreaGroups } from "../lib/jira-areas.mjs";
import { areaCacheStatements } from "../lib/jira-area-cache.ts";
import { personalAreaSchema } from "../lib/task-areas.ts";
import { jiraFixture, issue } from "./jira-fixture.mjs";

const fieldId = "customfield_123";
const work = { id: "local-work", name: "Work" }, learn = { id: "local-learn", name: "Learn" };
const seed = () => ({ areas: [work, learn], assignments: [{ key: "KAN-1", areaId: work.id }] });
function addChild(fixture, key = "KAN-3", parent = "KAN-1") {
  const child = issue(key); child.fields.parent = { key: parent }; child.fields.issuetype = { id: "subtask", name: "Subtask", subtask: true };
  fixture.issues.set(key, child); fixture.issues.get(parent)?.fields.subtasks.push({ key }); return child;
}
async function setup(options = {}, prepare) {
  const fixture = jiraFixture(); Object.assign(fixture.state, { areaField: true }, options); prepare?.(fixture);
  const client = await fixture.makeClient().initialise(), workspace = fixture.makeWorkspace();
  await workspace.prime(client); await workspace.synchronize(client);
  return { fixture, client, workspace };
}
async function drain(workspace, client) {
  for (let i = 0; i < 10; i++) { await workspace.synchronize(client); if (!workspace.queueSummary().pending) return; }
  assert.fail(JSON.stringify(workspace.queueSummary()));
}
const selected = (workspace, key) => workspace.viewIssue(key)?.fields[fieldId]?.id || null;
const remote = (fixture, key) => fixture.issues.get(key)?.fields[fieldId]?.id || null;

test("Area discovery prefers this project's single-select field and rejects ambiguous or malformed catalogs", () => {
  const make = (id, project, type = "option") => ({ id, name: "Area", schema: { type, custom: "jira:select" }, ...(project ? { scope: { project: { id: project } } } : {}) });
  const fields = [make("customfield_1"), make(fieldId, "10001"), make("customfield_2", "other")];
  assert.equal(findAreaField(fields, ["10001"]).id, fieldId);
  assert.equal(findAreaField(fields, ["10001"], "customfield_1").id, "customfield_1");
  assert.equal(findAreaField([make(fieldId, "10001", "array")], ["10001"]), null);
  assert.throws(() => findAreaField([make("customfield_1"), make("customfield_2")], ["10001"]), /More than one/);
  assert.equal(readAreaCatalog(null).ready, false);
  assert.throws(() => readAreaCatalog({ fieldId: "invalid", options: [] }));
  assert.throws(() => readAreaCatalog({ fieldId, options: [{ id: "1", name: "Work" }, { id: "2", name: " work " }] }));
});

test("legacy Areas migrate once including subtasks; existing Jira parent assignments win", async () => {
  const { fixture, client, workspace } = await setup({}, (fixture) => { addChild(fixture); fixture.issues.get("KAN-2").fields[fieldId] = { id: "203" }; });
  assert.equal(workspace.areaCatalogView().ready, true);
  await workspace.initializeAreas({ ...seed(), assignments: [...seed().assignments, { key: "KAN-2", areaId: work.id }] });
  const pending = workspace.queueSummary().pending;
  await workspace.initializeAreas(seed()); assert.equal(workspace.queueSummary().pending, pending);
  assert.equal(selected(workspace, "KAN-1"), "201"); assert.equal(selected(workspace, "KAN-3"), "201");
  assert.equal(selected(workspace, "KAN-2"), "203");
  assert.equal(fixture.calls.filter((call) => call.method === "PUT").length, 0);
  await drain(workspace, client);
  assert.equal(remote(fixture, "KAN-1"), "201"); assert.equal(remote(fixture, "KAN-3"), "201");
  assert.equal(remote(fixture, "KAN-2"), "203"); assert.equal(fixture.issues.size, 3);
  const read = fixture.calls.find((call) => call.path === "/rest/software/1.0/board/2/issue");
  assert.ok(read.url.searchParams.get("fields").split(",").includes(fieldId));
});

test("missing layouts or choices leave local migration untouched, then recover after Jira configuration changes", async () => {
  const { fixture, client, workspace } = await setup({ areaOnSubtask: false });
  await workspace.initializeAreas(seed()); assert.equal(workspace.state.areasMigrated, false);
  assert.match(workspace.areaCatalogView().message, /Task and Subtask/);
  fixture.state.areaOnSubtask = true; await client.refreshAreaCatalog(); await workspace.synchronize(client);
  await workspace.initializeAreas({ ...seed(), areas: [...seed().areas, { id: "finance", name: "Finance" }] });
  assert.equal(workspace.state.areasMigrated, false); assert.match(workspace.areaCatalogView().message, /Finance/);
  assert.equal(workspace.queueSummary().pending, 0);
  fixture.state.areaOptions.push({ id: "204", value: "Finance" }); await client.refreshAreaCatalog(); await workspace.synchronize(client);
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  assert.equal(workspace.state.areasMigrated, true); assert.equal(remote(fixture, "KAN-1"), "201");
});

test("without an Area field the existing local Areas remain usable and Jira task creation still works", async () => {
  const { workspace } = await setup({ areaField: false });
  await workspace.initializeAreas(seed()); assert.equal(workspace.state.areasMigrated, false);
  const created = await workspace.create({ requestId: randomUUID(), fields: { summary: "Local Areas setup" } });
  assert.ok(created.pending); assert.equal(workspace.areaCatalogView().fieldId, null);
});

test("offline moves keep parent and completed subtasks together, survive restart, and clear to Unassigned", async () => {
  const { fixture, client, workspace } = await setup({}, (fixture) => { const child = addChild(fixture); child.fields.status.statusCategory.key = "done"; });
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  fixture.state.offline = true;
  await workspace.assignArea({ keys: ["KAN-3"], optionId: "203" });
  assert.equal(selected(workspace, "KAN-1"), "203"); assert.equal(selected(workspace, "KAN-3"), "203");
  assert.equal(remote(fixture, "KAN-1"), "201");
  const restarted = fixture.makeWorkspace(); await restarted.load();
  assert.equal(selected(restarted, "KAN-1"), "203");
  fixture.state.offline = false; const reconnected = await fixture.makeClient().initialise(); await drain(restarted, reconnected);
  assert.equal(remote(fixture, "KAN-3"), "203");
  await restarted.assignArea({ keys: ["KAN-1"], optionId: null }); await drain(restarted, reconnected);
  assert.equal(remote(fixture, "KAN-1"), null); assert.equal(remote(fixture, "KAN-3"), null);
});

test("Jira-side parent changes return to the app and apply to the subtasks", async () => {
  const { fixture, client, workspace } = await setup({}, addChild);
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  fixture.issues.get("KAN-1").fields[fieldId] = { id: "202" };
  await drain(workspace, client);
  assert.equal(selected(workspace, "KAN-1"), "202"); assert.equal(remote(fixture, "KAN-3"), "202");
  const fresh = fixture.makeWorkspace(); fresh.store = { readState: async () => null, writeState: async () => {} };
  const restoredClient = await fixture.makeClient().initialise(); await fresh.prime(restoredClient); await fresh.synchronize(restoredClient);
  await fresh.initializeAreas({ areas: [], assignments: [] });
  assert.deepEqual(fresh.areaCatalogView().options.map((option) => option.name), ["Work", "Personal", "Learn"]);
  assert.equal(selected(fresh, "KAN-1"), "202");
});

test("conflicting offline moves wait for review, hold children, and allow a confirmed retry", async () => {
  const { fixture, client, workspace } = await setup({}, addChild);
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  await workspace.assignArea({ keys: ["KAN-1"], optionId: "203" });
  fixture.issues.get("KAN-1").fields[fieldId] = { id: "202" };
  await workspace.synchronize(client);
  const parent = workspace.state.queue.find((op) => op.key === "KAN-1");
  assert.equal(parent.status, "conflict"); assert.equal(parent.conflicts[0].field, "Area");
  assert.equal(remote(fixture, "KAN-3"), "201");
  await assert.rejects(() => workspace.retry(parent.id, false, client), /confirm/);
  await workspace.retry(parent.id, true, client); await drain(workspace, client);
  assert.equal(remote(fixture, "KAN-1"), "203"); assert.equal(remote(fixture, "KAN-3"), "203");
});

test("discarding a parent Area move also discards its dependent child moves", async () => {
  const { fixture, client, workspace } = await setup({}, addChild);
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  await workspace.assignArea({ keys: ["KAN-1"], optionId: "203" });
  const parent = workspace.state.queue.find((op) => op.key === "KAN-1");
  await workspace.discard(parent.id, true); assert.equal(workspace.queueSummary().pending, 0);
  assert.equal(selected(workspace, "KAN-3"), "201"); assert.equal(fixture.issues.size, 3);
});

test("a lost Jira Area write response is recovered without duplicate writes or assignments", async () => {
  const { fixture, client, workspace } = await setup();
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  await workspace.assignArea({ keys: ["KAN-1"], optionId: "203" });
  const before = fixture.calls.filter((call) => call.method === "PUT" && call.path.endsWith("/KAN-1")).length;
  fixture.afterFaults.set("PUT /rest/api/3/issue/KAN-1", true);
  await assert.rejects(() => workspace.synchronize(client));
  const restarted = fixture.makeWorkspace(); await restarted.load(); await drain(restarted, await fixture.makeClient().initialise());
  assert.equal(remote(fixture, "KAN-1"), "203");
  assert.equal(fixture.calls.filter((call) => call.method === "PUT" && call.path.endsWith("/KAN-1")).length, before + 1);
});

test("new tasks keep selected Area while subtasks inherit the parent, including temporary local parents", async () => {
  const { fixture, client, workspace } = await setup();
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  const parent = await workspace.create({ requestId: randomUUID(), fields: { summary: "Learn parent" }, areaOptionId: "203", subtasks: [{ requestId: randomUUID(), fields: { summary: "Bundled child" } }] });
  const child = await workspace.create({ requestId: randomUUID(), parentKey: parent.key, fields: { summary: "Later child" }, areaOptionId: "201" });
  assert.equal(selected(workspace, child.key), "203");
  await drain(workspace, client);
  assert.equal(remote(fixture, workspace.resolve(parent.key)), "203"); assert.equal(remote(fixture, workspace.resolve(child.key)), "203");
  const children = [...fixture.issues.values()].filter((issue) => issue.fields.parent?.key === workspace.resolve(parent.key));
  assert.equal(children.length, 2); assert.ok(children.every((issue) => issue.fields[fieldId]?.id === "203"));
});

test("invalid selections and disabled options cannot partially move a group", async () => {
  const { workspace, client } = await setup();
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  for (const payload of [{ keys: ["KAN-1", "KAN-999"], optionId: "203" }, { keys: ["KAN-1"], optionId: "999" }, { keys: [] }]) await assert.rejects(() => workspace.assignArea(payload));
  workspace.state.profile.metadata.areaCatalog.options.find((option) => option.id === "203").disabled = true;
  await assert.rejects(() => workspace.assignArea({ keys: ["KAN-1"], optionId: "203" }), /available Area/);
  assert.equal(selected(workspace, "KAN-1"), "201"); assert.equal(workspace.queueSummary().pending, 0);
});

test("orphan siblings and invalid parent cycles have one stable Area group", () => {
  const items = [issue("KAN-4"), issue("KAN-3"), issue("KAN-1"), issue("KAN-2")];
  items[0].fields.parent = { key: "KAN-3" }; items[1].fields.parent = { key: "KAN-4" };
  items[2].fields.parent = { key: "KAN-99" }; items[3].fields.parent = { key: "KAN-99" };
  assert.deepEqual(issueAreaGroups(items).map((group) => group.issues.map((issue) => issue.key).sort()).sort(), [["KAN-1", "KAN-2"], ["KAN-3", "KAN-4"]]);
});

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE tasks(id INTEGER PRIMARY KEY,source TEXT DEFAULT 'jira',jira_key TEXT UNIQUE); CREATE TABLE jira_task_aliases(local_key TEXT PRIMARY KEY,jira_key TEXT)");
  for (const sql of personalAreaSchema) db.exec(sql); return db;
}
const rows = (db) => db.prepare("SELECT * FROM personal_areas ORDER BY sort_order,name_key,id").all();
const catalog = (options = [{ id: "201", name: "Work" }, { id: "203", name: "Learn" }]) => ({ fieldId, projectId: "10001", ready: true, options });
function cache(db, value, issues, revision) {
  db.exec("BEGIN");
  try { for (const { sql, params } of areaCacheStatements(rows(db), value, issues, revision)) db.prepare(sql).run(...params); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
const assignments = (db) => db.prepare("SELECT task_id,area_id FROM personal_task_areas ORDER BY task_id").all().map((row) => ({ ...row }));

test("Area cache preserves local IDs and order, restores server assignments, and ignores stale snapshots", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks(id,jira_key) VALUES(1,'KAN-1'),(2,'KAN-2'); INSERT INTO personal_areas(id,name,name_key,sort_order) VALUES('local-work','Work','work',4)");
    cache(db, catalog(), [{ key: "KAN-1", fields: { [fieldId]: { id: "201" } } }], 10);
    assert.equal(rows(db)[0].id, "local-work"); assert.equal(rows(db)[0].sort_order, 4);
    const learnId = rows(db).find((area) => area.name === "Learn").id;
    cache(db, catalog([{ id: "201", name: "Work projects" }, { id: "203", name: "Learn" }]), [{ key: "KAN-1", fields: { [fieldId]: { id: "203" } } }], 20);
    cache(db, catalog(), [{ key: "KAN-1", fields: { [fieldId]: { id: "201" } } }], 11);
    assert.equal(rows(db).find((area) => area.id === "local-work").name, "Work projects");
    assert.deepEqual(assignments(db), [{ task_id: 1, area_id: learnId }]);
    cache(db, catalog([{ id: "201", name: "Work projects" }]), [{ key: "KAN-1", fields: { [fieldId]: null } }], 21);
    assert.equal(rows(db).length, 1); assert.deepEqual(assignments(db), [{ task_id: 1, area_id: null }]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 2);
  } finally { db.close(); }
});

test("fresh Area cache restores choices including unused ones and handles aliases and option-name swaps", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks(id,jira_key) VALUES(1,'KAN-1'); INSERT INTO jira_task_aliases VALUES('local:old','KAN-1')");
    cache(db, catalog(), [{ key: "local:old", fields: { [fieldId]: { id: "201" } } }], 2);
    const workId = rows(db).find((area) => area.name === "Work").id;
    assert.equal(rows(db).length, 2); assert.equal(assignments(db)[0].area_id, workId);
    cache(db, catalog([{ id: "201", name: "Learn" }, { id: "203", name: "Work" }]), [{ key: "KAN-1", fields: { [fieldId]: { id: "201" } } }], 3);
    assert.equal(rows(db).find((area) => area.id === workId).name, "Learn");
    cache(db, catalog([{ id: "201", name: "Learn" }, { id: "203", name: "Work" }]), [{ key: "KAN-1", fields: { [fieldId]: { id: "999" } } }], 4);
    assert.equal(assignments(db)[0].area_id, workId);
  } finally { db.close(); }
});

test("the broker exposes offline Area commands using the same queue as task edits", async () => {
  const { fixture } = await setup({}, addChild);
  const broker = new JiraConnection({ workspace: fixture.makeWorkspace(), createClient: fixture.makeClient, loadToken: async () => ({ token: "fake", source: "fixture" }), autoSync: false });
  await broker.connect(); await broker.command("areas-init", seed());
  broker.disconnect();
  const result = await broker.command("areas-assign", { keys: ["KAN-1"], optionId: "203" });
  assert.ok(result.queue.pending > 0); assert.equal(result.issues.find((issue) => issue.key === "KAN-3").fields[fieldId].id, "203");
});


test("new Jira choices refresh cached creation fields for offline tasks", async () => {
  const { fixture, client, workspace } = await setup();
  await workspace.initializeAreas(seed()); await drain(workspace, client);
  fixture.state.areaOptions.push({ id: "204", value: "Finance" });
  await client.refreshAreaCatalog(); await workspace.synchronize(client);
  fixture.state.offline = true;
  const task = await workspace.create({ requestId: randomUUID(), fields: { summary: "New Finance task offline" }, areaOptionId: "204" });
  assert.equal(selected(workspace, task.key), "204");
  fixture.state.offline = false; await drain(workspace, client);
  assert.equal(remote(fixture, workspace.resolve(task.key)), "204");
});

test("initial migration preserves a unique existing child Area instead of clearing it", async () => {
  const { fixture, client, workspace } = await setup({}, (fixture) => { addChild(fixture).fields[fieldId] = { id: "203" }; });
  await workspace.initializeAreas({ areas: [], assignments: [] }); await drain(workspace, client);
  assert.equal(remote(fixture, "KAN-1"), "203"); assert.equal(remote(fixture, "KAN-3"), "203");
});


test("an old offline cache waits for current Jira Area values before migrating local assignments", async () => {
  const { fixture, client, workspace } = await setup();
  delete workspace.state.issues["KAN-1"].fields[fieldId];
  fixture.issues.get("KAN-1").fields[fieldId] = { id: "202" };
  await workspace.initializeAreas(seed());
  assert.equal(workspace.state.areasMigrated, false); assert.equal(workspace.queueSummary().pending, 0);
  await workspace.synchronize(client); await workspace.initializeAreas(seed()); await drain(workspace, client);
  assert.equal(remote(fixture, "KAN-1"), "202"); assert.equal(selected(workspace, "KAN-1"), "202");
});
