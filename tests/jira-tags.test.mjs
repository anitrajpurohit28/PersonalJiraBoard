import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { JiraApi } from "../local/jira-api.mjs";
import { JiraConnection } from "../local/jira-connection.mjs";
import { applyLabelDelta, changeTagCatalog, jiraTagLabel, readTagCatalog, cloudTag } from "../lib/jira-tags.mjs";
import { tagCacheStatements } from "../lib/jira-tag-cache.ts";
import { personalTagSchema } from "../lib/task-tags.ts";
import { jiraFixture, accountId } from "./jira-fixture.mjs";

const work = { id: "work-id", name: "Work", label: "Work" };
const unused = { id: "unused-id", name: "20% return", label: "20%_return" };
const propertyKey = "personal-jira-board.tags.v1.board-2";
async function setup(options = {}) {
  const fixture = jiraFixture(); Object.assign(fixture.state, options);
  const workspace = fixture.makeWorkspace(), client = await fixture.makeClient().initialise();
  await workspace.prime(client); await workspace.synchronize(client);
  return { fixture, workspace, client };
}
async function drain(workspace, client) {
  for (let i=0; i<10; i++) { await workspace.synchronize(client); if (!workspace.queueSummary().pending) return; }
  assert.fail(JSON.stringify(workspace.queueSummary()));
}
const seed = () => ({ tags: [work, unused], assignments: [{ key: "KAN-1", tagIds: [work.id] }] });

test("Jira labels preserve readable names and delta edits preserve unrelated labels", () => {
  assert.equal(jiraTagLabel("  Personal   finance  "), "Personal_finance");
  for (const name of ["80%return", "A:Imp-critical", "smallTask", "日本語"]) assert.equal(cloudTag({ id: "tag-id", name }).label, name);
  assert.deepEqual(applyLabelDelta(["existing", "Work"], { add: ["Finance", "Finance"], remove: ["Work"] }), ["existing", "Finance"]);
  assert.deepEqual(applyLabelDelta(["existing", "Finance"], { add: ["Finance"], remove: ["missing"] }), ["existing", "Finance"]);
  for (const delta of [{ add: ["has spaces"] }, { remove: ["x"], add: ["x"] }, { add: "string" }]) assert.throws(() => applyLabelDelta([], delta));
  assert.throws(() => changeTagCatalog(null, { upsert: [work, { id: "other", name: "Other", label: "Work" }] }), /conflicts/);
  assert.throws(() => readTagCatalog({ version: 2, tags: [] }), /unsupported/);
});

test("existing tags migrate once, survive offline restart, preserve Jira labels and recover unused tags on a new installation", async () => {
  const { fixture, workspace } = await setup();
  fixture.issues.get("KAN-1").fields.labels = ["existing-label"];
  await workspace.initializeTags(seed());
  const count = workspace.queueSummary().pending;
  await workspace.initializeTags(seed()); assert.equal(workspace.queueSummary().pending, count);
  assert.deepEqual(workspace.viewIssue("KAN-1").fields.labels, ["Work"]);
  assert.equal(fixture.calls.filter((call) => call.method === "PUT").length, 0);
  const restarted = fixture.makeWorkspace(); await restarted.load();
  await drain(restarted, await fixture.makeClient().initialise());
  assert.deepEqual(fixture.issues.get("KAN-1").fields.labels.sort(), ["Work", "existing-label"]);
  const saved = fixture.properties.get(propertyKey);
  assert.ok(saved.tags.some((tag) => tag.name === unused.name));
  assert.ok(saved.tags.some((tag) => tag.label === "existing-label"));
  const fresh = new (fixture.makeWorkspace().constructor)({ store: { readState: async () => null, writeState: async () => {} } });
  const client = await fixture.makeClient().initialise();
  await fresh.prime(client); await fresh.synchronize(client); await fresh.initializeTags({ tags: [], assignments: [] });
  assert.ok(fresh.tagCatalogView().tags.some((tag) => tag.name === unused.name));
  assert.ok(fresh.viewIssue("KAN-1").fields.labels.includes("Work"));
});

test("tag rename and deletion update parent and subtask labels offline without deleting tasks or unrelated labels", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags({ tags: [work, unused], assignments: [{ key: "KAN-1", tagIds: [work.id] }, { key: "KAN-2", tagIds: [work.id] }] });
  await drain(workspace, client);
  fixture.issues.get("KAN-2").fields.labels.push("keep-in-jira");
  await workspace.saveTag({ tag: { id: work.id, name: "Work projects" } });
  assert.deepEqual(workspace.viewIssue("KAN-1").fields.labels, ["Work_projects"]);
  await drain(workspace, client);
  assert.deepEqual(fixture.issues.get("KAN-2").fields.labels.sort(), ["Work_projects", "keep-in-jira"]);
  assert.ok(fixture.properties.get(propertyKey).tags.some((tag) => tag.name === "Work projects"));
  await workspace.deleteTag(work.id); await drain(workspace, client);
  assert.deepEqual(fixture.issues.get("KAN-1").fields.labels, []);
  assert.deepEqual(fixture.issues.get("KAN-2").fields.labels, ["keep-in-jira"]);
  assert.equal(fixture.issues.size, 2);
  assert.equal(fixture.properties.get(propertyKey).tags.some((tag) => tag.id === work.id), false);
  assert.ok(fixture.properties.get(propertyKey).tags.some((tag) => tag.id === unused.id));
});

test("tag assignment is durable and idempotent across a lost Jira write response", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags({ tags: [work], assignments: [] }); await drain(workspace, client);
  await workspace.assignTag({ key: "KAN-1", tagId: work.id, assigned: true });
  await workspace.assignTag({ key: "KAN-1", tagId: work.id, assigned: true });
  assert.equal(workspace.state.queue.filter((op) => op.type === "labels").length, 1);
  fixture.afterFaults.set("PUT /rest/api/3/issue/KAN-1", true);
  await assert.rejects(() => workspace.synchronize(client));
  const restarted = fixture.makeWorkspace(); await restarted.load();
  await drain(restarted, await fixture.makeClient().initialise());
  assert.deepEqual(fixture.issues.get("KAN-1").fields.labels, ["Work"]);
  assert.equal(restarted.queueSummary().pending, 0);
});

test("new offline tasks keep chosen tags when temporary keys are replaced with Jira keys", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags({ tags: [work], assignments: [] });
  const parent = await workspace.create({ requestId: randomUUID(), projectId: "10001", issueTypeId: "task", fields: { summary: "Tagged parent", labels: ["Work"] }, subtasks: [] });
  const child = await workspace.create({ requestId: randomUUID(), parentKey: parent.key, fields: { summary: "Tagged child" } });
  await workspace.assignTag({ key: child.key, tagId: work.id, assigned: true });
  await drain(workspace, client);
  assert.ok(fixture.issues.get(workspace.resolve(parent.key)).fields.labels.includes("Work"));
  assert.ok(fixture.issues.get(workspace.resolve(child.key)).fields.labels.includes("Work"));
});

test("Jira-side label additions and removals reach the cached tags while catalog writes merge other installations", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags(seed()); await drain(workspace, client);
  const another = await fixture.makeClient().initialise();
  await another.changeTagCatalog({ upsert: [{ id: "finance-id", name: "Finance", label: "Finance" }] });
  fixture.issues.get("KAN-1").fields.labels = ["Finance", "new-jira-tag"];
  await drain(workspace, client);
  assert.deepEqual(workspace.viewIssue("KAN-1").fields.labels, ["Finance", "new-jira-tag"]);
  assert.ok(workspace.tagCatalogView().tags.some((tag) => tag.name === "new-jira-tag"));
  assert.ok(fixture.properties.get(propertyKey).tags.some((tag) => tag.name === unused.name));
  assert.ok(fixture.properties.get(propertyKey).tags.some((tag) => tag.name === "Finance"));
});

test("empty successful Jira account-property responses are accepted", async () => {
  const fixture = jiraFixture();
  const api = await new JiraApi("fake", { fetchImpl: async (url, init) => {
    const response = await fixture.fetchImpl(url, init);
    return init.method === "PUT" && url.includes("/user/properties/") ? new Response(null, { status: 201 }) : response;
  } }).initialise();
  assert.ok((await api.changeTagCatalog({ upsert: [work, unused] })).tags.some((tag) => tag.id === unused.id));
  assert.equal(fixture.calls.find((call) => call.path.includes("/user/properties/")).url.searchParams.get("accountId"), accountId);
});

function tagDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE tasks (id INTEGER PRIMARY KEY, source TEXT DEFAULT 'jira', jira_labels TEXT DEFAULT '[]')");
  for (const sql of personalTagSchema) db.exec(sql);
  return db;
}
const rows = (db) => db.prepare("SELECT * FROM personal_tags ORDER BY sort_order,name_key,id").all();
function cache(db, catalog, revision) {
  db.exec("BEGIN");
  try { for (const {sql,params} of tagCacheStatements(rows(db), catalog, revision)) db.prepare(sql).run(...params); db.exec("COMMIT"); }
  catch(error) { db.exec("ROLLBACK"); throw error; }
}

test("local tag migration keeps shortcuts, ordering and IDs; remote edits and stale responses reconcile safely", () => {
  const db = tagDatabase();
  try {
    db.prepare("INSERT INTO tasks (id, jira_labels) VALUES (?, ?)").run(1, JSON.stringify(["Work"]));
    db.exec("INSERT INTO personal_tags (id,name,name_key,shortcut,sort_order) VALUES ('local-work','Work','work','w',4)");
    cache(db, { version: 1, tags: [work, unused], retired: [] }, 10);
    assert.equal(rows(db).find((tag) => tag.name==='Work').id, "local-work");
    assert.equal(rows(db).find((tag) => tag.name==='Work').shortcut, "w");
    assert.equal(rows(db).find((tag) => tag.name==='Work').sort_order, 4);
    assert.deepEqual(db.prepare("SELECT task_id,tag_id FROM personal_task_tags").all().map((row)=>({...row})), [{ task_id:1, tag_id:"local-work" }]);
    const renamed = { ...work, name: "Work projects", label: "Work_projects" };
    db.prepare("UPDATE tasks SET jira_labels=? WHERE id=1").run(JSON.stringify([renamed.label]));
    cache(db, { version:1, tags:[renamed,unused], retired:[] }, 20);
    cache(db, { version:1, tags:[work], retired:[] }, 11);
    assert.equal(rows(db).find((tag)=>tag.id==='local-work').name, renamed.name);
    assert.equal(rows(db).length,2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM personal_task_tags").get().n,1);
    db.prepare("UPDATE tasks SET jira_labels='[]' WHERE id=1").run();
    cache(db, { version:1,tags:[renamed,unused],retired:[] }, 21);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM personal_task_tags").get().n,0);
  } finally { db.close(); }
});

test("a fresh database restores tag definitions and assignments including unused tags", () => {
  const db=tagDatabase();
  try {
    db.prepare("INSERT INTO tasks (id,jira_labels) VALUES (?,?)").run(1,JSON.stringify([work.label]));
    cache(db,{version:1,tags:[work,unused],retired:[]},3);
    assert.deepEqual(rows(db).map((tag)=>tag.name),["Work",unused.name]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM personal_task_tags").get().n,1);
    assert.equal(rows(db).find((tag)=>tag.id===unused.id).shortcut,null);
  } finally { db.close(); }
});


test("the connection exposes tag commands and keeps offline tag state available", async () => {
  const { fixture } = await setup();
  const broker = new JiraConnection({ workspace: fixture.makeWorkspace(), createClient: fixture.makeClient, loadToken: async () => ({ token: "fake", source: "fixture" }), autoSync:false });
  await broker.connect();
  await broker.command("tags-init", seed());
  broker.disconnect();
  await broker.command("tags-upsert", { tag: { id: "personal-id", name: "Personal" } });
  const assigned = await broker.command("tags-assign", { key: "KAN-1", tagId: "personal-id", assigned: true });
  assert.ok(assigned.issues.find((issue)=>issue.key==='KAN-1').fields.labels.includes('Personal'));
  const deleted = await broker.command("tags-delete", { tagId:work.id });
  assert.equal(deleted.tagCatalog.tags.some((tag)=>tag.id===work.id), false);
  assert.ok(deleted.queue.pending > 0);
});


test("case-sensitive labels in Jira remain distinct without violating the app's tag-name uniqueness", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags({ tags:[work], assignments:[] }); await drain(workspace,client);
  fixture.issues.get("KAN-1").fields.labels=["Work", "work"];
  await drain(workspace,client);
  const tags=workspace.tagCatalogView().tags;
  assert.deepEqual(tags.filter((tag)=>["Work","work"].includes(tag.label)).map((tag)=>tag.name).sort(),["Work","work (2)"]);
  assert.deepEqual(workspace.viewIssue("KAN-1").fields.labels,["Work","work"]);
});


test("an account tag backup is safe to retry after Jira accepted it but the response was lost", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags(seed());
  fixture.afterFaults.set(`PUT /rest/api/3/user/properties/${propertyKey}`, true);
  await assert.rejects(()=>workspace.synchronize(client));
  assert.ok(fixture.properties.get(propertyKey).tags.some((tag)=>tag.id===unused.id));
  const restarted=fixture.makeWorkspace();await restarted.load();await drain(restarted,await fixture.makeClient().initialise());
  assert.equal(fixture.properties.get(propertyKey).tags.filter((tag)=>tag.id===work.id).length,1);
  assert.ok(fixture.issues.get('KAN-1').fields.labels.includes('Work'));
});

test("saving an unchanged imported tag name preserves its original Jira label", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags({tags:[work],assignments:[]});await drain(workspace,client);
  fixture.issues.get('KAN-1').fields.labels=['work'];await drain(workspace,client);
  const imported=workspace.tagCatalogView().tags.find((tag)=>tag.label==='work');
  assert.equal(imported.name,'work (2)');
  await workspace.saveTag({tag:{id:imported.id,name:imported.name}});await drain(workspace,client);
  assert.deepEqual(fixture.issues.get('KAN-1').fields.labels,['work']);
});


test("subtasks inherit queued parent labels offline, preserve overrides and sync unchanged after restart", async () => {
  const { fixture, workspace, client } = await setup();
  await workspace.initializeTags({ tags: [work, unused], assignments: [] });
  await workspace.assignTag({ key: "KAN-1", tagId: work.id, assigned: true });
  const context = await workspace.createContext({ parentKey: "KAN-1" });
  assert.deepEqual(context.fields.find((field) => field.fieldId === "labels").defaultValue, ["Work"]);
  assert.equal((await workspace.createContext({ projectId: "10001" })).fields.find((field) => field.fieldId === "labels").defaultValue, undefined);
  const create = (summary, fields = {}) => workspace.create({ requestId: randomUUID(), parentKey: "KAN-1", fields: { summary, ...fields } });
  const inherited = await create("Inherited labels");
  const overridden = await create("Chosen labels", { labels: ["Finance"] });
  const cleared = await create("No labels", { labels: [] });
  assert.deepEqual(inherited.issue.fields.labels, ["Work"]);
  assert.deepEqual(overridden.issue.fields.labels, ["Finance"]);
  assert.deepEqual(cleared.issue.fields.labels, []);
  // Inheritance is a creation default, not a permanent link to the parent's labels.
  await workspace.assignTag({ key: "KAN-1", tagId: unused.id, assigned: true });
  const restarted = fixture.makeWorkspace(); await restarted.load();
  assert.deepEqual(restarted.viewIssue(inherited.key).fields.labels, ["Work"]);
  await drain(restarted, client);
  assert.deepEqual(fixture.issues.get(restarted.resolve(inherited.key)).fields.labels, ["Work"]);
  assert.deepEqual(fixture.issues.get(restarted.resolve(overridden.key)).fields.labels, ["Finance"]);
  assert.deepEqual(fixture.issues.get(restarted.resolve(cleared.key)).fields.labels, []);
  assert.deepEqual(fixture.issues.get("KAN-1").fields.labels, ["Work", "20%_return"]);
});

test("batch subtasks inherit a new parent's labels, including an unsynced parent, without overwriting explicit choices", async () => {
  const { fixture, workspace, client } = await setup();
  const child = (summary, labels) => ({ requestId: randomUUID(), fields: { summary, ...(labels === undefined ? {} : { labels }) } });
  const created = await workspace.create({ requestId: randomUUID(), projectId: "10001", issueTypeId: "task", fields: { summary: "Labelled parent", labels: ["Work", "80%return"] }, subtasks: [child("Inherited batch child"), child("Explicit batch child", ["Personal"]), child("Untagged batch child", [])] });
  const children = workspace.children(created.key);
  const extra = await workspace.create({ requestId: randomUUID(), parentKey: created.key, fields: { summary: "Another child of unsynced parent" } });
  assert.deepEqual(children.map((row) => workspace.viewIssue(row.key).fields.labels), [["Work", "80%return"], ["Personal"], []]);
  assert.deepEqual(extra.issue.fields.labels, ["Work", "80%return"]);
  await drain(workspace, client);
  assert.deepEqual(children.map((row) => fixture.issues.get(workspace.resolve(row.key)).fields.labels), [["Work", "80%return"], ["Personal"], []]);
  assert.deepEqual(fixture.issues.get(workspace.resolve(extra.key)).fields.labels, ["Work", "80%return"]);
});


test("labels omitted from Jira creation fields are inherited through a durable follow-up after task creation", async () => {
  const { fixture, workspace, client } = await setup({ omitCreateLabels: true });
  await workspace.initializeTags(seed());
  const child = await workspace.create({ requestId: randomUUID(), parentKey: "KAN-1", fields: { summary: "Labels hidden at creation" } });
  const cleared = await workspace.create({ requestId: randomUUID(), parentKey: "KAN-1", fields: { summary: "Explicitly untagged child", labels: [] } });
  const parent = await workspace.create({ requestId: randomUUID(), projectId: "10001", issueTypeId: "task", fields: { summary: "New tagged parent", labels: ["Work", "80%return"] }, subtasks: [{ requestId: randomUUID(), fields: { summary: "Batched tagged child" } }] });
  const batchChild = workspace.children(parent.key)[0];
  assert.deepEqual(workspace.viewIssue(child.key).fields.labels, ["Work"]);
  assert.deepEqual(workspace.viewIssue(cleared.key).fields.labels, []);
  assert.deepEqual(workspace.viewIssue(batchChild.key).fields.labels, ["Work", "80%return"]);
  const restarted = fixture.makeWorkspace(); await restarted.load();
  await drain(restarted, client);
  assert.deepEqual(fixture.issues.get(restarted.resolve(child.key)).fields.labels, ["Work"]);
  assert.deepEqual(fixture.issues.get(restarted.resolve(cleared.key)).fields.labels, []);
  assert.deepEqual(fixture.issues.get(restarted.resolve(parent.key)).fields.labels, ["Work", "80%return"]);
  assert.deepEqual(fixture.issues.get(restarted.resolve(batchChild.key)).fields.labels, ["Work", "80%return"]);
  assert.ok(fixture.calls.filter((call) => call.method === "POST" && call.path === "/rest/api/3/issue").every((call) => call.body.fields.labels === undefined));
});

test("a failed post-create label response retries without creating the subtask twice or losing inherited labels", async () => {
  const { fixture, workspace, client } = await setup({ omitCreateLabels: true });
  await workspace.initializeTags(seed()); await drain(workspace, client);
  const child = await workspace.create({ requestId: randomUUID(), parentKey: "KAN-1", fields: { summary: "Durable inherited labels" } });
  fixture.afterFaults.set("PUT /rest/api/3/issue/KAN-11", true);
  await assert.rejects(() => workspace.synchronize(client));
  assert.deepEqual(workspace.viewIssue(child.key).fields.labels, ["Work"]);
  const restarted = fixture.makeWorkspace(); await restarted.load(); await drain(restarted, client);
  assert.deepEqual(fixture.issues.get(restarted.resolve(child.key)).fields.labels, ["Work"]);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path === "/rest/api/3/issue").length, 1);
});
