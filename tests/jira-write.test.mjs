import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { settings, configuredSite } from "../config/settings.mjs";
import { adfText, toAdf, prepareFields } from "../lib/jira-fields.mjs";
import { JiraApi } from "../local/jira-api.mjs";
import { jiraFixture, accountId, issue, baseFields } from "./jira-fixture.mjs";

const createRequest = (fields = {}) => ({ requestId: randomUUID(), projectId: "10001", issueTypeId: "task", fields: { summary: "New personal task", ...fields } });

test("API token authentication sends credentials only to the configured Jira endpoint and does not follow redirects", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  assert.equal(jira.identity.emailAddress, settings.email);
  assert.ok(fixture.calls.every(({ url }) => url.origin === configuredSite));
  assert.match(fixture.calls[0].headers.Authorization, /^Basic /);
  let redirects;
  const redirectClient = new JiraApi("fake", { fetchImpl: async (_url, init) => { redirects = init.redirect; return new Response(null, { status: 302, headers: { Location: "https://evil.example" } }); } });
  await assert.rejects(() => redirectClient.verify(), /302/);
  assert.equal(redirects, "manual");
  await assert.rejects(() => jira.request("https://evil.example/rest/api/3/myself"), /Invalid/);
});

test("scoped API tokens automatically use the discovered cloud ID without browser installation", async () => {
  const fixture = jiraFixture(); fixture.state.gatewayOnly = true;
  const jira = await fixture.makeClient().initialise();
  assert.match(jira.restBase, /^https:\/\/api.atlassian.com\/ex\/jira\//);
  const tenant = fixture.calls.find(({ path }) => path === "/_edge/tenant_info");
  assert.equal(tenant.headers?.Authorization, undefined);
  assert.equal(jira.identity.accountId, accountId);
});

test("create fields come from Jira, default to Task, and enforce extra required fields", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  const context = await jira.createContext();
  assert.equal(context.issueType.name, "Task");
  assert.deepEqual(context.projects.map(({ key }) => key), ["KAN"]);
  await assert.rejects(() => jira.create(createRequest({ summary: "" })), /summary is required/);
  fixture.state.extraFields = [{ fieldId: "customfield_10", name: "Category", required: true, hasDefaultValue: false, schema: { type: "option" }, allowedValues: [{ id: "A", value: "Personal" }] }];
  await assert.rejects(() => jira.create(createRequest()), /Category is required/);
  assert.equal(fixture.calls.filter(({ method, path }) => method === "POST" && path === "/rest/api/3/issue").length, 0);
  const created = await jira.create(createRequest({ customfield_10: "A", description: "First line\nSecond line", duedate: "2026-11-10", assignee: accountId }));
  assert.match(created.key, /^KAN-/);
  const sent = fixture.calls.find(({ method, path }) => method === "POST" && path === "/rest/api/3/issue").body.fields;
  assert.deepEqual(sent.project, { id: "10001" });
  assert.deepEqual(sent.issuetype, { id: "task" });
  assert.deepEqual(sent.customfield_10, { id: "A" });
  assert.deepEqual(sent.assignee, { accountId });
  assert.equal(adfText(sent.description).trimEnd(), "First line\nSecond line");
});

test("subtasks require a valid same-project parent in the configured board", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  const payload = { ...createRequest(), issueTypeId: "subtask" };
  await assert.rejects(() => jira.create(payload), /parent is required/);
  fixture.excluded.add("KAN-2");
  await assert.rejects(() => jira.create({ ...payload, fields: { ...payload.fields, parent: "KAN-2" } }), /outside/);
  const result = await jira.create({ ...payload, fields: { ...payload.fields, parent: "KAN-1" } });
  assert.equal(result.issue.fields.parent.key, "KAN-1");
});

test("a retried creation request never creates the same Jira issue twice", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  const payload = createRequest();
  const first = await jira.create(payload), second = await jira.create(payload);
  assert.equal(first.key, second.key);
  assert.equal(fixture.calls.filter(({ method, path }) => method === "POST" && path === "/rest/api/3/issue").length, 1);
  await assert.rejects(() => jira.create({ ...payload, fields: { summary: "Different task" } }), /request ID/);
});

test("an uncertain create is not automatically replayed, including after a helper restart", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  const payload = createRequest();
  fixture.faults.set("POST /rest/api/3/issue", new Error("Network dropped"));
  await assert.rejects(() => jira.create(payload), (error) => error.uncertain === true);
  fixture.faults.clear();
  const restarted = await fixture.makeClient().initialise();
  await assert.rejects(() => restarted.create(payload), /previous creation/);
  assert.equal(fixture.calls.filter(({ method, path }) => method === "POST" && path === "/rest/api/3/issue").length, 1);
});

test("Jira acceptance followed by a read failure still returns the created key", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  fixture.faults.set("GET /rest/api/3/issue/KAN-11", { status: 503 });
  const result = await jira.create(createRequest());
  assert.equal(result.created, true);
  assert.equal(result.key, "KAN-11");
  assert.match(result.warning, /could not be refreshed/);
});

test("shared field edits write to Jira; private notes are not sent as Jira fields", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  const result = await jira.update("KAN-1", { expectedUpdatedAt: issue().fields.updated, fields: { summary: "Updated in the tool", description: "Description", priority: "2", duedate: "2026-11-01", assignee: accountId }, notes: "Private" });
  assert.equal(result.issue.fields.summary, "Updated in the tool");
  const sent = fixture.calls.find(({ method }) => method === "PUT").body.fields;
  assert.deepEqual(sent.priority, { id: "2" });
  assert.equal("notes" in sent, false);
  await assert.rejects(() => jira.update("KAN-1", { expectedUpdatedAt: issue().fields.updated, fields: { summary: "Stale edit" } }), /changed in Jira/);
});

test("transitions, completion, and restore use the Jira workflow", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  assert.equal((await jira.update("KAN-1", { targetColumnId: "jira-column-0" })).issue.fields.status.name, "To Do");
  assert.equal((await jira.update("KAN-1", { action: "done" })).issue.fields.status.statusCategory.key, "done");
  const count = fixture.calls.filter(({ method }) => method === "POST").length;
  await jira.update("KAN-1", { action: "done" });
  assert.equal(fixture.calls.filter(({ method }) => method === "POST").length, count);
  assert.equal((await jira.update("KAN-1", { action: "restore" })).issue.fields.status.name, "To Do");
});

test("required transition fields and partial bulk failures are reported without claiming success", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  fixture.state.transitionFields = { resolution: { name: "Resolution", required: true, schema: { type: "option" }, allowedValues: [{ id: "1", name: "Done" }] } };
  await assert.rejects(() => jira.update("KAN-1", { action: "done" }), /requires Resolution/);
  assert.equal(fixture.issues.get("KAN-1").fields.status.statusCategory.key, "indeterminate");
  await jira.update("KAN-1", { action: "done", transitionFields: { resolution: "1" } });
  fixture.state.transitionFields = {};
  fixture.faults.set("POST /rest/api/3/issue/KAN-2/transitions", { status: 403 });
  const result = await jira.bulk("done", ["KAN-1", "KAN-2"]);
  assert.deepEqual(result.succeeded.map(({ key }) => key), ["KAN-1"]);
  assert.equal(result.failed[0].key, "KAN-2");
});

test("delete never cascades to unselected subtasks and supports explicitly selected child then parent", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  const child = issue("KAN-3"); child.fields.issuetype.subtask = true; child.fields.parent = { key: "KAN-1" };
  fixture.issues.set(child.key, child); fixture.issues.get("KAN-1").fields.subtasks = [{ key: child.key }];
  await assert.rejects(() => jira.remove("KAN-1"), /subtasks first/);
  assert.equal(fixture.issues.has("KAN-3"), true);
  const result = await jira.bulk("delete", ["KAN-1", "KAN-3"]);
  assert.deepEqual(result.succeeded.map(({ key }) => key), ["KAN-3", "KAN-1"]);
  assert.ok(fixture.calls.filter(({ method }) => method === "DELETE").every(({ url }) => url.searchParams.get("deleteSubtasks") === "false"));
});

test("wrong email, out-of-board writes, invalid required fields and invalid dates are rejected", async () => {
  const fixture = jiraFixture(), jira = await fixture.makeClient().initialise();
  fixture.excluded.add("KAN-2");
  await assert.rejects(() => jira.update("KAN-2", { fields: { summary: "Must not save" } }), /outside/);
  await assert.rejects(() => jira.update("KAN-1", { fields: { duedate: "2026-02-31" } }), /valid date/);
  await jira.update("KAN-1", { fields: { assignee: "someone-else" } });
  assert.equal(fixture.issues.get("KAN-1").fields.assignee.accountId, accountId);
  fixture.calls.length = 0;
  fixture.state.identity.emailAddress = "wrong@example.com";
  await assert.rejects(() => jira.update("KAN-1", { action: "done" }), /only accepts/);
  assert.equal(fixture.calls.filter(({ method }) => ["PUT", "DELETE", "POST"].includes(method)).length, 0);
  assert.throws(() => prepareFields(baseFields, { project: "bad" }, accountId), /supplied options/);
  assert.equal(adfText(toAdf("A\nB")).trimEnd(), "A\nB");
});
