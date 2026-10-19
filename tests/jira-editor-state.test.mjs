import assert from "node:assert/strict";
import test from "node:test";
import { cachedTaskEditor } from "../lib/jira-editor-state.ts";
import { comparableField } from "../lib/jira-fields.mjs";

const task = { jiraKey: "KAN-1", title: "Cached summary", description: "First paragraph\nSecond paragraph", jiraPriorityId: "normal", jiraPriority: "Medium", jiraStatusId: "now", state: "Now", parentKey: null, dueDate: "2026-10-20", labels: ["home"], projectId: "personal", projectKey: "KAN", issueTypeId: "task", issueType: "Task", isSubtask: false, archived: false, jiraUpdatedAt: "2026-10-19T02:00:00.000Z" };
const fields = ["summary", "description", "priority", "duedate", "labels"].map(fieldId => ({ fieldId, name: fieldId, required: fieldId === "summary", schema: { type: "string" }, allowedValues: [] }));
const session = { connected: true, accountId: "me", editorSchemas: { "personal:task": fields }, metadata: { columns: [{ statuses: [{ id: "now", name: "Now", category: "indeterminate" }, { id: "done", name: "Done", category: "done" }] }], priorities: [{ id: "low", name: "Low" }, { id: "normal", name: "Medium" }, { id: "high", name: "High" }] } };

test("the first editor render contains the complete cached task and the Jira site's field schema", () => {
  const original = structuredClone({ task, session });
  const cached = cachedTaskEditor(task, session);
  assert.deepEqual(cached.fields, fields);
  assert.equal(cached.issue.fields.summary, task.title);
  assert.equal(cached.issue.fields.description, task.description);
  assert.equal(cached.issue.fields.priority.id, "normal");
  assert.equal(cached.issue.fields.status.id, "now");
  assert.equal(cached.issue.fields.duedate, task.dueDate);
  assert.deepEqual(cached.issue.fields.labels, ["home"]);
  assert.equal(cached.issue.fields.updated, task.jiraUpdatedAt);
  assert.deepEqual(cached.transitions.map(t => t.to.name), ["Now", "Done"]);
  assert.deepEqual({ task, session }, original);
});

test("cached values can render before the connection check, offline, and for subtasks without inventing Jira IDs", () => {
  const child = { ...task, isSubtask: true, issueTypeId: "subtask", parentKey: "KAN-10" };
  for (const connection of [null, { ...session, connected: false }]) {
    const cached = cachedTaskEditor(child, connection);
    assert.equal(cached.offline, true);
    assert.equal(cached.issue.fields.parent.key, "KAN-10");
    assert.equal(cached.issue.fields.issuetype.subtask, true);
    assert.equal(cached.issue.fields.summary, task.title);
    assert.equal(cached.fields.find(f => f.fieldId === "priority").allowedValues[0].id, connection ? "low" : "normal");
  }
  assert.equal(cachedTaskEditor(undefined, session), null); // Creation still uses real create metadata.
});

test("a cached plain-text description remains a valid conflict baseline for Jira ADF", () => {
  const cached = cachedTaskEditor(task, session);
  const remote = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "First paragraph" }] }, { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] }] };
  assert.equal(comparableField("description", cached.issue.fields.description), comparableField("description", remote));
});


test("the first render uses the current board status name even when the task snapshot has its old name", () => {
  const cached = cachedTaskEditor({ ...task, state: "In Progress" }, session);
  assert.equal(cached.issue.fields.status.id, "now");
  assert.equal(cached.issue.fields.status.name, "Now");
});
