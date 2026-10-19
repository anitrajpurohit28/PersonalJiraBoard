import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { settings, configuredSite, configuredBoardId, validateSettings } from "../config/settings.mjs";
import { issuePriority, jiraSiteOrigin, matchesConfiguredSite } from "../lib/jira-personal.mjs";
import { personalJql, readJiraIssues, verifyIdentity } from "../lib/jira-reader.mjs";
import { JiraConnection } from "../local/jira-connection.mjs";
import { createJiraHelperServer } from "../local/jira-server.mjs";
import { planPersonalJiraSync } from "../lib/jira-sync-plan.ts";
import { jiraDateMigrations, jiraPriorityButtons } from "../lib/jira-fields.mjs";
import { jiraCacheChanges, resolveCachedJiraIssues } from "../lib/jira-cache-changes.mjs";
import { jiraFixture, accountId, identity, issue } from "./jira-fixture.mjs";

test("priority buttons offer only High, Medium and Low using the site's Jira IDs", () => {
  const priorities = [
    { id: "urgent-id", name: "Highest" }, { id: "high-id", name: "High" },
    { id: "normal-id", name: "Medium" }, { id: "low-id", name: "Low" }, { id: "trivial-id", name: "Lowest" },
  ];
  const original = structuredClone(priorities);
  const expected = [{ id: "high-id", name: "High" }, { id: "normal-id", name: "Medium" }, { id: "low-id", name: "Low" }];
  assert.deepEqual(jiraPriorityButtons(priorities, "normal-id"), { options: expected, value: "normal-id" });
  assert.equal(jiraPriorityButtons(priorities, { id: "urgent-id" }).value, "high-id");
  assert.equal(jiraPriorityButtons(priorities, "trivial-id").value, "low-id");
  assert.deepEqual(priorities, original); // Viewing a legacy extreme must not rewrite Jira metadata.
  assert.deepEqual(jiraPriorityButtons([priorities[2]], "normal-id").options, [expected[1]]);
  assert.deepEqual(jiraPriorityButtons([], undefined), { options: [], value: "" });
  for (const [name, expected] of [["Highest", 2], ["High", 2], ["Medium", 3], ["Low", 4], ["Lowest", 4]]) {
    assert.equal(issuePriority({ fields: { priority: { name } } }), expected);
  }
});

test("main configuration still contains only email and the board URL; credentials stay separate", async () => {
  const config = JSON.parse(await readFile(new URL("../config/app.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(config).sort(), ["email", "jiraUrl"]);
  assert.equal(settings.email, "anitrajpurohit28@gmail.com");
  assert.equal(configuredSite, "https://anitrajpurohit28.atlassian.net");
  assert.equal(configuredBoardId, "2");
  assert.match(await readFile(new URL("../.gitignore", import.meta.url), "utf8"), /\/config\/credentials\.json/);
  for (const config of [{}, { email: "bad", jiraUrl: settings.jiraUrl }, { ...settings, jiraUrl: "http://insecure.example" }, { ...settings, apiToken: "must-be-private" }]) assert.throws(() => validateSettings(config));
});

test("only the configured email and site are accepted", () => {
  assert.equal(verifyIdentity({ ...identity, emailAddress: settings.email.toUpperCase() }, settings.email).displayName, "Anit");
  assert.throws(() => verifyIdentity({ ...identity, emailAddress: "other@example.com" }, settings.email), /only accepts/);
  assert.throws(() => verifyIdentity({ accountId }, settings.email), /only accepts/);
  assert.equal(jiraSiteOrigin("https://myhome.atlassian.net.evil.example/"), null);
  assert.equal(matchesConfiguredSite(configuredSite, null), true);
  assert.equal(matchesConfiguredSite("https://other.atlassian.net", null), false);
});

test("a configured board imports unassigned tasks across all pages without an ownership filter", async () => {
  const calls = [];
  const result = await readJiraIssues(async (path) => {
    calls.push(path); const url = new URL(path, configuredSite);
    assert.equal(url.pathname, "/rest/software/1.0/board/2/issue");
    assert.equal(url.searchParams.has("jql"), false);
    return url.searchParams.has("nextPageToken") ? { issues: [issue("KAN-2")], isLast: true } : { issues: [issue()], nextPageToken: "page-two", isLast: false };
  }, { accountId, boardId: "2" });
  assert.deepEqual(result.map(({ key }) => key), ["KAN-1", "KAN-2"]);
  assert.equal(calls.length, 2);
});

test("a site-only URL restricts issues to the configured account", async () => {
  const mine = issue(); mine.fields.reporter = { accountId };
  const result = await readJiraIssues(async (path) => {
    assert.equal(new URL(path, configuredSite).searchParams.get("jql"), personalJql());
    return { issues: [mine, issue("KAN-2")], isLast: true };
  }, { accountId });
  assert.equal(result.length, 1);
});

test("incomplete pagination never returns a partial snapshot", async () => {
  for (const page of [{ issues: [issue()], isLast: false }, { issues: [] }, { issues: [], nextPageToken: "repeat", isLast: false }]) {
    await assert.rejects(() => readJiraIssues(async () => page, { accountId, boardId: "2" }), /Nothing was imported/);
  }
  let first = true;
  const result = await readJiraIssues(async (path) => {
    if (first) { first = false; throw Object.assign(new Error("Not enabled"), { status: 404 }); }
    assert.match(path, /\/rest\/agile\/1.0\/board\/2\/issue/);
    return { issues: [issue()], total: 1 };
  }, { accountId, boardId: "2" });
  assert.equal(result.length, 1);
});

test("the helper connects with a private API token and never exposes it in public status", async () => {
  const fixture = jiraFixture(); let saved;
  const broker = new JiraConnection({ workspace: fixture.makeWorkspace(), autoSync: false, loadToken: async () => null, saveToken: async (token) => { saved = token; }, createClient: fixture.makeClient });
  assert.equal((await broker.status()).connected, false);
  await broker.connect({ apiToken: "fake-test-token", remember: true });
  assert.equal(saved, "fake-test-token");
  assert.equal(broker.publicStatus().connected, true);
  assert.equal(JSON.stringify(broker.publicStatus()).includes("fake-test-token"), false);
  await assert.rejects(() => broker.command("delete", { key: "KAN-1" }), /Confirm deleting/);
  fixture.state.identity.emailAddress = "wrong@example.com";
  await broker.tick();
  assert.match(broker.publicStatus().message, /only accepts/);
  assert.equal(broker.publicStatus().connected, false);
});

test("HTTP helper rejects foreign origins and old extension traffic and supports direct creation", async () => {
  const fixture = jiraFixture();
  const broker = new JiraConnection({ workspace: fixture.makeWorkspace(), autoSync: false, loadToken: async () => ({ token: "fake-test-token", source: "test" }), createClient: fixture.makeClient });
  const server = createJiraHelperServer(broker);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/jira/connect`, { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(`${base}/api/jira/bridge/next`, { headers: { Origin: `chrome-extension://${"a".repeat(32)}` } })).status, 403);
    await fetch(`${base}/api/jira/status`);
    await broker.connect();
    const response = await fetch(`${base}/api/jira/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), projectId: "10001", issueTypeId: "task", fields: { summary: "Created through the API helper" } }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.created, true);
    assert.equal(result.pending, true);
    await broker.tick();
    assert.equal(result.issue.fields.summary, "Created through the API helper");
    assert.equal(JSON.stringify(result).includes("fake-test-token"), false);
    const denied = await fetch(`${base}/api/jira/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: result.key }) });
    assert.equal(denied.status, 400);
    assert.equal(fixture.issues.has(broker.workspace.resolve(result.key)), true);
    broker.disconnect();
    assert.equal((await fetch(`${base}/api/jira/issues`, { method: "POST" })).status, 200);
  } finally { broker.disconnect(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks (
    id INTEGER PRIMARY KEY, jira_key TEXT UNIQUE, jira_url TEXT, title TEXT, priority INTEGER, status TEXT,
    source TEXT DEFAULT 'manual', jira_status TEXT, jira_status_category TEXT, jira_priority TEXT,
    jira_assignee TEXT, jira_reporter TEXT, jira_created_at TEXT, jira_updated_at TEXT, jira_synced_at TEXT,
    jira_query_active INTEGER DEFAULT 1, archived INTEGER DEFAULT 0, completed_at TEXT, manual_order INTEGER,
    notes TEXT DEFAULT '', notify_at TEXT, notify_fired INTEGER DEFAULT 0, updated_at TEXT,
    jira_status_id TEXT, jira_description TEXT, jira_priority_id TEXT, jira_assignee_id TEXT,
    jira_project_id TEXT, jira_project_key TEXT, jira_issue_type_id TEXT, jira_issue_type TEXT,
    jira_parent_key TEXT, jira_due_date TEXT, jira_labels TEXT, jira_pending_until TEXT,
    jira_sync_status TEXT, jira_sync_error TEXT, jira_sync_revision INTEGER DEFAULT 0, jira_is_subtask INTEGER DEFAULT 0, jira_comments TEXT
  ); CREATE TABLE jira_task_aliases (local_key TEXT PRIMARY KEY, jira_key TEXT); CREATE TABLE jira_deleted_tasks (jira_key TEXT PRIMARY KEY)`);
  return db;
}
function apply(db, plan) { db.exec("BEGIN"); try { for (const { sql, params } of plan.statements) db.prepare(sql).run(...params); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } }
function plan(db, issues, options = {}) {
  return planPersonalJiraSync(issues, db.prepare("SELECT * FROM tasks WHERE source = 'jira'").all(), configuredSite, accountId, "2026-10-15T12:00:00Z", { kind: "board", boardId: "2" }, options);
}

test("Jira edits preserve reminders until completion clears them permanently, including after reopening", () => {
  const db = database();
  try {
    apply(db, plan(db, [issue(), issue("KAN-2")]));
    db.exec("UPDATE tasks SET notes = 'Keep private', notify_at = '2030-01-01', manual_order = 7, notify_fired = 1, status = 'later' WHERE jira_key = 'KAN-1'");
    const changed = issue(); changed.fields.summary = "Changed in Jira";
    apply(db, plan(db, [changed, issue("KAN-2")]));
    let row = db.prepare("SELECT * FROM tasks WHERE jira_key = 'KAN-1'").get();
    assert.equal(row.title, "Changed in Jira"); assert.equal(row.notes, "Keep private");
    assert.equal(row.jira_status_id, "20"); assert.equal(row.status, "now");
    assert.equal(row.notify_at, "2030-01-01"); assert.equal(row.notify_fired, 1);
    apply(db, plan(db, [issue("KAN-1", "done"), issue("KAN-2")]));
    row = db.prepare("SELECT * FROM tasks WHERE jira_key = 'KAN-1'").get();
    assert.equal(row.archived, 1); assert.equal(row.notify_at, null); assert.equal(row.notify_fired, 0); assert.equal(row.notes, "Keep private");
    apply(db, plan(db, [issue(), issue("KAN-2")]));
    assert.equal(db.prepare("SELECT archived FROM tasks WHERE jira_key = 'KAN-1'").get().archived, 0);
    assert.equal(db.prepare("SELECT notify_at FROM tasks WHERE jira_key = 'KAN-1'").get().notify_at, null);
  } finally { db.close(); }
});

test("external deletion hides the cached Jira card and keeps private notes and local tasks", () => {
  const db = database();
  try {
    apply(db, plan(db, [issue()]));
    db.exec("UPDATE tasks SET notes = 'Retained'; INSERT INTO tasks (jira_key, title, source) VALUES ('PTB-1', 'Local', 'manual')");
    apply(db, plan(db, []));
    assert.equal(db.prepare("SELECT jira_query_active FROM tasks WHERE source = 'jira'").get().jira_query_active, 0);
    assert.equal(db.prepare("SELECT notes FROM tasks WHERE source = 'jira'").get().notes, "Retained");
    assert.equal(db.prepare("SELECT jira_query_active FROM tasks WHERE source = 'manual'").get().jira_query_active, 1);
  } finally { db.close(); }
});

test("single issue write results do not hide other cards and duplicate create responses cannot duplicate a card", () => {
  const db = database();
  try {
    apply(db, plan(db, [issue(), issue("KAN-2")]));
    apply(db, plan(db, [issue()], { complete: false }));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE jira_query_active = 1").get().count, 2);
    const empty = [];
    const duplicate = planPersonalJiraSync([issue()], empty, configuredSite, accountId, undefined, { kind: "board", boardId: "2" }, { complete: false });
    apply(db, duplicate);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 2);
  } finally { db.close(); }
});

test("a stale pull cannot overwrite a later successful Jira write", () => {
  const db = database();
  try {
    apply(db, plan(db, [issue()]));
    const stale = plan(db, [issue()]);
    db.exec("UPDATE tasks SET title = 'Latest write', status = 'done', archived = 1, jira_updated_at = '2026-10-15T13:00:00.000Z'");
    apply(db, stale);
    const row = db.prepare("SELECT * FROM tasks").get();
    assert.equal(row.title, "Latest write"); assert.equal(row.archived, 1);
  } finally { db.close(); }
});

test("existing Jira timestamps with a +0530 offset migrate before version comparisons", () => {
  const db = database();
  try {
    apply(db, plan(db, [issue()]));
    db.exec("UPDATE tasks SET jira_updated_at = '2026-10-15T15:30:00.000+0530', jira_status_id = NULL");
    const rows = db.prepare("SELECT * FROM tasks").all();
    for (const row of jiraDateMigrations(rows)) db.prepare("UPDATE tasks SET jira_updated_at = ?, jira_created_at = ? WHERE id = ? AND jira_updated_at IS ?").run(row.updatedAt, row.createdAt, row.id, row.previous);
    apply(db, plan(db, [issue()]));
    assert.equal(db.prepare("SELECT jira_status_id FROM tasks").get().jira_status_id, "20");
  } finally { db.close(); }
});

test("a newly created issue is not hidden while Jira's search index catches up", () => {
  const db = database();
  try {
    apply(db, plan(db, [issue()], { complete: false, createdLocally: true }));
    apply(db, plan(db, []));
    assert.equal(db.prepare("SELECT jira_query_active FROM tasks").get().jira_query_active, 1);
  } finally { db.close(); }
});

test("a stale workspace revision cannot overwrite pending edits or hide newer tasks", () => {
  const db = database();
  try {
    const oldIssue = { ...issue(), syncRevision: 5 };
    apply(db, plan(db, [oldIssue], { revision: 5 }));
    const staleEdit = plan(db, [oldIssue], { revision: 5 });
    const staleMissing = plan(db, [], { revision: 5 });
    const newer = { ...issue(), syncRevision: 6, syncStatus: "pending" }; newer.fields.summary = "Saved offline";
    apply(db, plan(db, [newer], { revision: 6 }));
    apply(db, staleEdit); apply(db, staleMissing);
    const row = db.prepare("SELECT * FROM tasks").get();
    assert.equal(row.title, "Saved offline"); assert.equal(row.jira_sync_status, "pending"); assert.equal(row.jira_query_active, 1);
  } finally { db.close(); }
});

test("an in-flight local-key response cannot recreate a duplicate after Jira assigns the real key", () => {
  const db = database(), local = `local:${randomUUID()}`;
  try {
    db.exec("CREATE TABLE task_updates (task_id INTEGER, body TEXT)");
    const pending = { ...issue(), key: local, syncRevision: 5 };
    apply(db, plan(db, [pending], { revision: 5 }));
    db.exec("UPDATE tasks SET notes = 'Keep private', notify_at = '2030-01-01', manual_order = 7");
    const id = db.prepare("SELECT id FROM tasks").get().id;
    for (const statement of jiraCacheChanges({ [local]: "KAN-10" })) db.prepare(statement.sql).run(...statement.params);
    apply(db, plan(db, [{ ...issue(), key: "KAN-10", syncRevision: 6 }], { revision: 6 }));
    const aliases = Object.fromEntries(db.prepare("SELECT local_key, jira_key FROM jira_task_aliases").all().map((row) => [row.local_key, row.jira_key]));
    apply(db, plan(db, resolveCachedJiraIssues([pending], aliases, []), { revision: 5 }));
    const rows = db.prepare("SELECT * FROM tasks").all();
    assert.equal(rows.length, 1); assert.equal(rows[0].id, id); assert.equal(rows[0].jira_key, "KAN-10");
    assert.equal(rows[0].notes, "Keep private"); assert.equal(rows[0].notify_at, "2030-01-01"); assert.equal(rows[0].jira_sync_revision, 6); assert.equal(rows[0].manual_order, 7);
    assert.equal(resolveCachedJiraIssues([pending], aliases, ["KAN-10"]).length, 0);
    const staleInsert = planPersonalJiraSync([pending], [], configuredSite, accountId, undefined, { kind: "board", boardId: "2" });
    apply(db, staleInsert);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
    for (const statement of jiraCacheChanges({}, ["KAN-10"])) db.prepare(statement.sql).run(...statement.params);
    apply(db, planPersonalJiraSync([{ ...issue(), key: "KAN-10" }], [], configuredSite, accountId, undefined, { kind: "board", boardId: "2" }));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 0);
  } finally { db.close(); }
});


test("offline Done clears the cached reminder before reconnecting, and replay does not resurrect it", async () => {
  const fixture = jiraFixture(), workspace = fixture.makeWorkspace(), db = database();
  try {
    await workspace.load();
    const client = await fixture.makeClient().initialise();
    await workspace.run(() => workspace.prime(client));
    await workspace.synchronize(client);
    apply(db, plan(db, workspace.snapshot().issues));
    db.exec("UPDATE tasks SET notify_at = '2026-10-16T05:00:00Z', notify_fired = 1 WHERE jira_key = 'KAN-1'");
    await workspace.update("KAN-1", { action: "done" });
    const pending = workspace.snapshot();
    apply(db, plan(db, pending.issues, { revision: pending.revision }));
    let row = db.prepare("SELECT * FROM tasks WHERE jira_key = 'KAN-1'").get();
    assert.equal(row.archived, 1); assert.equal(row.notify_at, null); assert.equal(row.notify_fired, 0);
    assert.notEqual(fixture.issues.get("KAN-1").fields.status.statusCategory.key, "done");
    await workspace.synchronize(client);
    apply(db, plan(db, workspace.snapshot().issues));
    row = db.prepare("SELECT * FROM tasks WHERE jira_key = 'KAN-1'").get();
    assert.equal(row.archived, 1); assert.equal(row.notify_at, null); assert.equal(row.notify_fired, 0);
    assert.equal(fixture.issues.get("KAN-1").fields.status.statusCategory.key, "done");
  } finally { db.close(); }
});

test("a stale Done snapshot cannot clear a reminder rescheduled after a newer active Jira revision", () => {
  const db = database();
  try {
    apply(db, plan(db, [{ ...issue(), syncRevision: 10 }]));
    db.exec("UPDATE tasks SET notify_at = '2030-01-01', manual_order = 9");
    apply(db, plan(db, [{ ...issue('KAN-1', 'done'), syncRevision: 9 }]));
    const row = db.prepare("SELECT * FROM tasks").get();
    assert.equal(row.archived, 0); assert.equal(row.notify_at, "2030-01-01"); assert.equal(row.manual_order, 9);
  } finally { db.close(); }
});
