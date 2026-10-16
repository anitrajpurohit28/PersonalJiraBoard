import assert from "node:assert/strict";
import test from "node:test";
import { groupBoardTasks, filterTaskGroups, matchesTaskSearch, parseTaskSearch } from "../lib/board-tasks.ts";
import { validateUiSettings } from "../config/ui-settings.mjs";
const task = (id, values = {}) => ({ id, jiraKey: `KAN-${id}`, title: `Task ${id}`, parentKey: null, isSubtask: false, archived: false, source: "jira", priority: 3, jiraPriority: "Medium", description: "", notes: "", updates: [], comments: [], labels: [], state: "In Progress", status: "now", syncStatus: "synced", ...values });
const filters = (values = {}) => ({ view: "active", source: "all", priority: "all", state: "all", query: "", ...values });

test("subtasks and other Jira child issues appear once, inside their parent group", () => {
  const parent = task(1), child = task(2, { parentKey: "KAN-1", isSubtask: true }), otherChild = task(3, { parentKey: "KAN-1" });
  const groups = groupBoardTasks([child, parent, otherChild, task(4)]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].parent.id, 1);
  assert.deepEqual(groups[0].children.map((row) => row.id), [2, 3]);
  assert.equal(groups.filter((group) => [2, 3].includes(group.parent?.id)).length, 0);
});

test("missing parents group their subtasks without hiding or duplicating them", () => {
  const groups = groupBoardTasks([task(2, { parentKey: "KAN-99", isSubtask: true }), task(3, { parentKey: "KAN-99", isSubtask: true })]);
  assert.equal(groups.length, 1); assert.equal(groups[0].parent, null); assert.equal(groups[0].children.length, 2);
});

test("completed subtasks stay in Active until their parent is Done", () => {
  const parent = task(1), child = task(2, { parentKey: "KAN-1", isSubtask: true, archived: true });
  const grouped = groupBoardTasks([parent, child]);
  assert.deepEqual(filterTaskGroups(grouped, filters())[0].matches.map((row) => row.id), [1, 2]);
  assert.equal(filterTaskGroups(grouped, filters({ view: "done" })).length, 0);
  parent.archived = true;
  assert.equal(filterTaskGroups(grouped, filters()).length, 0);
  assert.deepEqual(filterTaskGroups(grouped, filters({ view: "done" }))[0].matches.map((row) => row.id), [1, 2]);
});

test("a completed parent places its whole group in Done, including unfinished children", () => {
  const grouped = groupBoardTasks([task(1, { archived: true }), task(2, { parentKey: "KAN-1", isSubtask: true })]);
  assert.equal(filterTaskGroups(grouped, filters()).length, 0);
  assert.deepEqual(filterTaskGroups(grouped, filters({ view: "done" }))[0].matches.map((row) => row.id), [1, 2]);
});

test("reminders include fired, future, child and completed reminders, without unrelated groups", () => {
  const rows = [task(1), task(2, { parentKey: "KAN-1", archived: true, notifyAt: "2026-10-16T06:00:00Z", notifyFired: true }), task(3, { notifyAt: "2026-10-20T06:00:00Z" }), task(4), task(5, { archived: true, notifyAt: "2026-10-20T06:00:00Z" })];
  const reminders = filterTaskGroups(groupBoardTasks(rows), filters({ view: "reminders" }));
  assert.deepEqual(reminders.map((group) => group.parent.id), [1, 3, 5]);
  assert.deepEqual(reminders.flatMap((group) => group.matches).map((row) => row.id), [2, 3, 5]);
  assert.equal(reminders[0].parent.notifyAt, undefined);
});

test("All highs includes High and Highest", () => {
  const groups = groupBoardTasks([task(1, { priority: 1 }), task(2, { priority: 2 }), task(3), task(4, { priority: 4 })]);
  assert.deepEqual(filterTaskGroups(groups, filters({ priority: "high" })).map((group) => group.parent.id), [1, 2]);
});

test("search matches independent fragments across keys, descriptions, labels and cached comments", () => {
  const row = task(2097, { title: "Outlook meeting", description: "Refresh calendar", labels: ["personal"], comments: [{ body: "Follow up tomorrow", author: "Anit" }] });
  for (const query of ["outlook 2097", "kan2097 refresh", "personal tomorrow", '"follow up" outlook', "comment:tomorrow", "has:comments", "priority:medium", 'status:"In Progress"']) assert.equal(matchesTaskSearch([row], query), true, query);
  for (const query of ["outlook missing", '"meeting outlook"', "outlook -tomorrow", "priority:low", "has:due"]) assert.equal(matchesTaskSearch([row], query), false, query);
});

test("a child search returns its parent and supports terms spanning parent and subtask", () => {
  const groups = groupBoardTasks([task(1, { title: "Prepare release" }), task(2, { parentKey: "KAN-1", title: "Review notes", isSubtask: true })]);
  const result = filterTaskGroups(groups, filters({ query: "KAN1 review is:subtask" }));
  assert.equal(result.length, 1); assert.equal(result[0].parent.id, 1); assert.equal(result[0].children[0].id, 2);
  assert.equal(filterTaskGroups(groups, filters({ query: "-review" })).length, 0);
});

test("quoted field values, exclusions, accents and dates work without fuzzy false positives", () => {
  const row = task(2, { title: "Café notes", dueDate: "2026-10-16", notes: "https://example.com/path", labels: ["home-office"] });
  assert.equal(matchesTaskSearch([row], 'cafe label:"home-office" due:today', "2026-10-16"), true);
  assert.equal(matchesTaskSearch([row], "due:overdue", "2026-10-17"), true);
  assert.equal(matchesTaskSearch([{ ...row, archived: true }], "due:overdue", "2026-10-17"), false);
  assert.equal(matchesTaskSearch([row], "https://example.com/path"), true);
  assert.equal(matchesTaskSearch([row], '"cafe notes" -label:work'), true);
  assert.equal(matchesTaskSearch([row], "key:KAN12"), false);
  assert.deepEqual(parseTaskSearch('-status:"In Progress" key:KAN2').map(({ field, value, exclude }) => ({ field, value, exclude })), [{ field: "status", value: "in progress", exclude: true }, { field: "key", value: "kan2", exclude: false }]);
});

test("parent display does not silently select children excluded by priority and status filters", () => {
  const groups = groupBoardTasks([task(1), task(2, { parentKey: "KAN-1", priority: 2, state: "Inbox" })]);
  const matches = filterTaskGroups(groups, filters({ priority: "2", state: "Inbox" }))[0];
  assert.deepEqual(matches.matches.map((row) => row.id), [2]);
  assert.equal(matches.parent.id, 1);
  assert.equal(filterTaskGroups(groups, filters({ priority: "4" })).length, 0);
});

test("display layout configuration accepts right or center without changing account configuration", () => {
  assert.equal(validateUiSettings({ taskDetailsPosition: "right" }).taskDetailsPosition, "right");
  assert.equal(validateUiSettings({ taskDetailsPosition: "center" }).taskDetailsPosition, "center");
  assert.throws(() => validateUiSettings({ taskDetailsPosition: "bottom" }));
  assert.throws(() => validateUiSettings({ taskDetailsPosition: "right", apiToken: "wrong-file" }));
});
