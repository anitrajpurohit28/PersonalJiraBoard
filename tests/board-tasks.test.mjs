import assert from "node:assert/strict";
import test from "node:test";
import { groupBoardTasks, filterTaskGroups, sortTaskGroups, orderSubtasks, taskAgeInDays, taskCreationTime, matchesTaskSearch, parseTaskSearch, isTaskOverdue } from "../lib/board-tasks.ts";
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

test("reminders include active fired, future and child reminders but exclude completed tasks", () => {
  const rows = [task(1), task(2, { parentKey: "KAN-1", archived: false, notifyAt: "2026-10-16T06:00:00Z", notifyFired: true }), task(3, { notifyAt: "2026-10-20T06:00:00Z" }), task(4), task(5, { archived: true, notifyAt: "2026-10-20T06:00:00Z" })];
  const reminders = filterTaskGroups(groupBoardTasks(rows), filters({ view: "reminders" }));
  assert.deepEqual(reminders.map((group) => group.parent.id), [1, 3]);
  assert.deepEqual(reminders.flatMap((group) => group.matches).map((row) => row.id), [2, 3]);
  assert.equal(reminders[0].parent.notifyAt, undefined);
});

test("Overdue lists unfinished past-due tasks and child matches with their parent context", () => {
  const today = "2026-10-19";
  const rows = [task(1), task(2, { parentKey: "KAN-1", dueDate: "2026-10-18" }), task(3, { dueDate: "2026-10-17" }), task(4, { dueDate: today }), task(5, { dueDate: "2026-10-20" }), task(6, { dueDate: "2026-10-01", archived: true }), task(7, { notifyAt: "2026-10-18T06:00:00Z", notifyFired: true })];
  const overdue = filterTaskGroups(groupBoardTasks(rows), filters({ view: "overdue" }), today);
  assert.deepEqual(overdue.map((group) => group.parent.id), [1, 3]);
  assert.deepEqual(overdue.flatMap((group) => group.matches).map((row) => row.id), [2, 3]);
  assert.equal(overdue[0].parent.dueDate, undefined);
  assert.equal(overdue.flatMap((group) => group.matches).length, rows.filter((row) => isTaskOverdue(row, today)).length);
});

test("Overdue begins after the local due day ends and excludes completed tasks", () => {
  const row = task(1, { dueDate: "2026-12-31" });
  for (const [today, expected] of [["2026-12-30", false], ["2026-12-31", false], ["2027-01-01", true]]) {
    assert.equal(isTaskOverdue(row, today), expected);
    assert.equal(matchesTaskSearch([row], "due:overdue", today), expected);
    assert.equal(filterTaskGroups(groupBoardTasks([row]), filters({ view: "overdue" }), today).length > 0, expected);
  }
  assert.equal(isTaskOverdue({ ...row, archived: true }, "2027-01-01"), false);
  assert.equal(isTaskOverdue(task(2), "2027-01-01"), false);
  assert.equal(isTaskOverdue(task(3, { dueDate: null }), "2027-01-01"), false);
});

test("Overdue finds unfinished children even under completed or uncached parents", () => {
  const rows = [task(1, { archived: true, dueDate: "2026-10-01" }), task(2, { parentKey: "KAN-1", dueDate: "2026-10-18" }), task(3, { parentKey: "KAN-99", dueDate: "2026-10-18" }), task(4, { parentKey: "KAN-99", archived: true, dueDate: "2026-10-18" })];
  const overdue = filterTaskGroups(groupBoardTasks(rows), filters({ view: "overdue" }), "2026-10-19");
  assert.deepEqual(overdue.flatMap((group) => group.matches).map((row) => row.id), [2, 3]);
  assert.equal(overdue[0].parent.archived, true);
  assert.equal(overdue[1].parent, null);
});

test("Overdue supports search and priority filters without selecting unrelated siblings", () => {
  const rows = [task(1, { title: "Prepare release" }), task(2, { parentKey: "KAN-1", title: "Review notes", priority: 2, dueDate: "2026-10-18" }), task(3, { parentKey: "KAN-1", priority: 2 }), task(4, { dueDate: "2026-10-18", priority: 4 })];
  const grouped = groupBoardTasks(rows);
  const result = filterTaskGroups(grouped, filters({ view: "overdue", priority: "high", query: "release review due:overdue" }), "2026-10-19");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].matches.map((row) => row.id), [2]);
  assert.equal(filterTaskGroups(grouped, filters({ view: "overdue", query: "missing" }), "2026-10-19").length, 0);
  assert.equal(filterTaskGroups(grouped, filters({ view: "overdue", source: "manual" }), "2026-10-19").length, 0);
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

const sortedGroups = (rows, sort, view = "active", today = "2026-10-18") => sortTaskGroups(filterTaskGroups(groupBoardTasks(rows), filters({ view }), today), sort, today);
const groupIds = (groups) => groups.map((group) => group.parent?.id ?? group.children[0].id);

test("Priority ignores urgency overrides while Days keeps overdue dates and fired reminders first", () => {
  const rows = [
    task(1, { priority: 2, createdAt: "2026-10-01" }),
    task(2, { createdAt: "2026-10-02", dueDate: "2026-10-18" }),
    task(3, { priority: 4, createdAt: "2026-10-16", dueDate: "2026-10-17" }),
    task(4, { priority: 4, createdAt: "2026-10-17", notifyAt: "2026-10-17T06:00:00Z", notifyFired: true }),
    task(5, { priority: 4, createdAt: "2026-09-30", dueDate: "2026-10-19" }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "priority")), [1, 2, 5, 3, 4]);
  assert.deepEqual(groupIds(sortedGroups(rows, "oldest")), [3, 4, 5, 1, 2]);
});

test("a due date becomes overdue after its local calendar day, including a year boundary", () => {
  const rows = [task(1, { priority: 2, createdAt: "2026-01-01" }), task(2, { priority: 4, createdAt: "2026-12-31", dueDate: "2026-12-31" })];
  assert.deepEqual(groupIds(sortedGroups(rows, "oldest", "active", "2026-12-31")), [1, 2]);
  assert.deepEqual(groupIds(sortedGroups(rows, "oldest", "active", "2027-01-01")), [2, 1]);
});

test("fired reminders remain first in Days until cleared, but never override High-first Priority", () => {
  const high = task(1, { priority: 2, createdAt: "2026-01-01" });
  const reminder = task(2, { priority: 4, createdAt: "2026-10-17", notifyAt: "2026-10-16T06:00:00Z", notifyFired: true });
  for (const sort of ["priority", "oldest"]) {
    assert.deepEqual(groupIds(sortedGroups([high, reminder], sort)), sort === "priority" ? [1, 2] : [2, 1]);
    assert.deepEqual(groupIds(sortedGroups([high, { ...reminder, notifyAt: null }], sort)), [1, 2]);
    assert.deepEqual(groupIds(sortedGroups([high, { ...reminder, notifyAt: "2026-10-20T06:00:00Z", notifyFired: false }], sort)), [1, 2]);
    assert.deepEqual(groupIds(sortedGroups([high, { ...reminder, notifyFired: false }], sort)), [1, 2]);
  }
});

test("urgent subtasks lift the parent only in Days, without shuffling the child list or mutating the cache", () => {
  for (const urgent of [{ dueDate: "2026-10-17" }, { notifyAt: "2026-10-17T06:00:00Z", notifyFired: true }]) {
    const rows = [task(1, { priority: 4, createdAt: "2026-10-17" }), task(2, { priority: 2, createdAt: "2026-01-01" }), task(3, { parentKey: "KAN-1" }), task(4, { parentKey: "KAN-1", priority: 4, ...urgent })];
    const groups = filterTaskGroups(groupBoardTasks(rows), filters());
    for (const sort of ["priority", "oldest"]) {
      const sorted = sortTaskGroups(groups, sort, "2026-10-18");
      assert.deepEqual(groupIds(sorted), sort === "priority" ? [2, 1] : [1, 2]);
      assert.deepEqual(sorted.find((group) => group.parent.id === 1).children.map((child) => child.id), [3, 4]);
      assert.equal(sorted.length, 2);
      assert.deepEqual(groups[0].children.map((child) => child.id), [3, 4]);
    }
  }
});

test("completed subtasks never lift their parent, even if an older cache still contains their fired reminder", () => {
  const rows = [task(1, { priority: 4, createdAt: "2026-10-17" }), task(2, { priority: 2, createdAt: "2026-01-01" }), task(3, { parentKey: "KAN-1", archived: true, dueDate: "2026-10-16" })];
  for (const sort of ["priority", "oldest"]) {
    assert.deepEqual(groupIds(sortedGroups(rows, sort)), [2, 1]);
    assert.deepEqual(groupIds(sortedGroups([...rows.slice(0, 2), { ...rows[2], notifyAt: "2026-10-16T06:00:00Z", notifyFired: true }], sort)), [2, 1]);
  }
});

test("urgent orphaned subtasks stay grouped and lift only in Days", () => {
  const rows = [task(1, { priority: 2, createdAt: "2026-01-01" }), task(2, { parentKey: "KAN-99", priority: 4, createdAt: "2026-10-17", dueDate: "2026-10-17" }), task(3, { parentKey: "KAN-99", createdAt: "2026-10-17" })];
  for (const sort of ["priority", "oldest"]) assert.deepEqual(groupIds(sortedGroups(rows, sort)), sort === "priority" ? [1, 2] : [2, 1]);
});

test("Reminders honors strict Priority or urgent-first Days", () => {
  const rows = [
    task(1, { priority: 4, createdAt: "2026-10-10", notifyAt: "2026-10-19T06:00:00Z" }),
    task(2, { priority: 4, createdAt: "2026-10-09", dueDate: "2026-10-17", notifyAt: "2026-11-01T06:00:00Z" }),
    task(3, { priority: 2, createdAt: "2026-10-18", notifyAt: "2026-10-16T06:00:00Z", notifyFired: true }),
    task(4, { priority: 2, createdAt: "2026-10-19", notifyAt: "2026-10-20T06:00:00Z" }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "priority", "reminders")), [3, 4, 2, 1]);
  assert.deepEqual(groupIds(sortedGroups(rows, "oldest", "reminders")), [2, 3, 1, 4]);
});

test("age counts full elapsed days, includes the exact 24-hour boundary, and never goes below zero", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.equal(taskAgeInDays(task(1, { createdAt: "2026-10-17T12:00:01Z" }), now), 0);
  assert.equal(taskAgeInDays(task(1, { createdAt: "2026-10-17T12:00:00Z" }), now), 1);
  assert.equal(taskAgeInDays(task(1, { createdAt: "2026-10-16T11:59:59Z" }), now), 2);
  assert.equal(taskAgeInDays(task(1, { createdAt: "2026-10-19T12:00:00Z" }), now), 0);
});

test("Jira age uses the original creation date rather than the date imported into this board", () => {
  const row = task(1, { jiraCreatedAt: "2026-10-01T12:00:00Z", createdAt: "2026-10-18 12:00:00" });
  assert.equal(taskAgeInDays(row, Date.parse("2026-10-18T12:00:00Z")), 17);
  assert.equal(taskCreationTime(row), Date.parse("2026-10-01T12:00:00Z"));
});

test("local and legacy timestamps use UTC, equivalent Jira offsets agree, and invalid dates do not invent an age", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  for (const createdAt of ["2026-10-17 12:00:00", "2026-10-17T12:00:00Z", "2026-10-17T17:30:00+0530"]) {
    assert.equal(taskAgeInDays(task(1, { createdAt, jiraCreatedAt: null }), now), 1);
  }
  assert.equal(taskAgeInDays(task(1, { createdAt: "2026-10-17 12:00:00", jiraCreatedAt: "invalid" }), now), 1);
  assert.equal(taskAgeInDays(task(1, { createdAt: "invalid", jiraCreatedAt: null }), now), null);
  assert.equal(taskAgeInDays(task(1, { createdAt: "", jiraCreatedAt: "" }), now), null);
});

test("Days sorting agrees with Jira age badges while overdue tasks still stay first", () => {
  const rows = [
    task(1, { priority: 2, createdAt: "2026-09-01 00:00:00", jiraCreatedAt: "2026-10-17T12:00:00Z" }),
    task(2, { priority: 4, createdAt: "2026-10-18 00:00:00", jiraCreatedAt: "2026-09-01T12:00:00Z" }),
    task(3, { dueDate: "2026-10-17", createdAt: "2026-10-18 00:00:00", jiraCreatedAt: "2026-10-18T00:00:00Z" }),
    task(4, { createdAt: "invalid", jiraCreatedAt: null }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "oldest")), [3, 2, 1, 4]);
  assert.deepEqual(groupIds(sortedGroups(rows.slice(0, 3), "priority")), [1, 3, 2]);
});


test("Priority sorts all High before all Medium before all Low, ignoring urgency and manual ranks", () => {
  const rows = [
    task(1, { priority: 4, dueDate: "2026-10-17", manualOrder: 0 }),
    task(2, { priority: 3, notifyAt: "2026-10-17T06:00:00Z", notifyFired: true, manualOrder: 1 }),
    task(3, { priority: 2, dueDate: "2026-10-17", manualOrder: 2 }),
    task(4, { priority: 4, manualOrder: 3 }), task(5, { priority: 3, manualOrder: 4 }), task(6, { priority: 2, manualOrder: 5 }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "priority")), [3, 6, 2, 5, 1, 4]);
});

test("manual sorting respects dragged positions; choosing either automatic mode reapplies its urgency and sort rules", () => {
  const rows = [
    task(1, { priority: 4, manualOrder: 0, createdAt: "2026-10-17" }),
    task(2, { priority: 2, manualOrder: 1, createdAt: "2026-10-16" }),
    task(3, { priority: 3, manualOrder: 2, createdAt: "2026-10-15", dueDate: "2026-10-17" }),
    task(4, { priority: 3, manualOrder: null, createdAt: "2026-10-18" }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "manual")), [1, 2, 3, 4]);
  assert.deepEqual(groupIds(sortedGroups(rows, "priority")), [2, 3, 4, 1]);
  assert.deepEqual(groupIds(sortedGroups(rows, "oldest")), [3, 2, 1, 4]);
});

test("new subtasks append despite newest-first API results, priority changes, completion and local-to-Jira key mapping", () => {
  const first = task(2, { parentKey: "KAN-1", createdAt: "2026-10-15 09:00:00", archived: true });
  const second = task(3, { parentKey: "KAN-1", createdAt: "2026-10-16 09:00:00", manualOrder: null });
  const newest = task(4, { jiraKey: "local:pending", parentKey: "KAN-1", createdAt: "2026-10-18 09:00:00", priority: 2 });
  for (const sort of ["priority", "oldest", "manual"]) {
    for (const child of [newest, { ...newest, jiraKey: "KAN-99", jiraCreatedAt: "2026-10-15T09:01:00Z" }]) {
      assert.deepEqual(sortedGroups([child, task(1), second, first], sort)[0].children.map((row) => row.id), [2, 3, 4]);
    }
  }
  const sameTime = [task(5, { createdAt: "2026-10-18" }), task(4, { createdAt: "2026-10-18" })];
  assert.deepEqual(orderSubtasks(sameTime).map((row) => row.id), [4, 5]);
  assert.deepEqual(orderSubtasks([{ ...second, manualOrder: 0 }, { ...first, manualOrder: 1 }, newest]).map((row) => row.id), [3, 2, 4]);
});


test("Priority sorts High then Medium then Low, oldest-created first inside every priority", () => {
  const rows = [
    task(90, { priority: 2, createdAt: "2026-09-01", jiraCreatedAt: "2026-10-17T12:00:00Z", manualOrder: 0 }),
    task(80, { priority: 4, createdAt: "2026-01-01", manualOrder: 1 }),
    task(70, { priority: 3, createdAt: "2026-10-14T12:00:00Z", manualOrder: 2 }),
    task(100, { priority: 2, createdAt: "2026-10-18", jiraCreatedAt: "2026-10-01T12:00:00Z", manualOrder: 3 }),
    task(50, { priority: 4, createdAt: "2026-02-01", manualOrder: 4 }),
    task(110, { priority: 3, createdAt: "2026-10-10T12:00:00Z", manualOrder: 5 }),
  ];
  const original = structuredClone(rows);
  for (const view of ["active", "done"]) {
    const tasks = rows.map(row => ({ ...row, archived: view === "done" }));
    assert.deepEqual(groupIds(sortedGroups(tasks, "priority", view)), [100, 90, 110, 70, 80, 50]);
  }
  assert.deepEqual(rows, original);
});

test("overdue parents, fired reminders and urgent children cannot outrank a higher priority or older peer", () => {
  const rows = [
    task(1, { priority: 2, createdAt: "2026-01-01" }),
    task(2, { priority: 2, createdAt: "2026-10-17", notifyAt: "2026-10-16T06:00:00Z", notifyFired: true }),
    task(3, { priority: 2, createdAt: "2026-10-10" }),
    task(4, { parentKey: "KAN-3", dueDate: "2026-10-16" }),
    task(5, { priority: 3, createdAt: "2026-01-01", dueDate: "2026-10-16" }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "priority")), [1, 3, 2, 5]);
});

test("legacy High priorities share one age order and equivalent timezones use stable oldest IDs", () => {
  const rows = [
    task(4, { priority: 1, jiraCreatedAt: "2026-10-15T15:30:00+0530" }),
    task(3, { priority: 2, jiraCreatedAt: "2026-10-15T10:00:00Z" }),
    task(5, { priority: 2, jiraCreatedAt: "2026-10-14T10:00:00Z" }),
  ];
  for (const sort of ["priority", "oldest"]) assert.deepEqual(groupIds(sortedGroups(rows, sort)), [5, 3, 4]);
});

test("Priority keeps valid ages first and retains tasks with missing or invalid creation dates", () => {
  const rows = [
    task(3, { priority: 2, createdAt: "invalid", jiraCreatedAt: null }),
    task(2, { priority: 2, createdAt: "", jiraCreatedAt: null }),
    task(4, { priority: 2, createdAt: "2026-10-01 12:00:00", jiraCreatedAt: "invalid" }),
    task(1, { priority: 3, createdAt: "2026-01-01" }),
  ];
  assert.deepEqual(groupIds(sortedGroups(rows, "priority")), [4, 2, 3, 1]);
});


test("the reported KAN-1 / KAN-10 case puts High KAN-10 before overdue Medium KAN-1", () => {
  const medium = task(1, { priority: 3, createdAt: "2026-09-30", dueDate: "2026-10-07" });
  const high = task(10, { priority: 2, createdAt: "2026-10-16" });
  assert.deepEqual(groupIds(sortedGroups([medium, high], "priority", "active", "2026-10-19")), [10, 1]);
  assert.deepEqual(groupIds(sortedGroups([medium, high], "oldest", "active", "2026-10-19")), [1, 10]);
});


test("private tags are searchable separately from Jira labels and filter matching subtasks with parent context", () => {
  const work = { id: "work", name: "Work", shortcut: "w" };
  const finance = { id: "finance", name: "Personal Finance", shortcut: "f" };
  const rows = [task(1, { title: "Prepare release", labels: ["jira-only"] }), task(2, { parentKey: "KAN-1", title: "Review notes", tags: [work] }), task(3, { tags: [finance] })];
  const groups = groupBoardTasks(rows);
  assert.equal(matchesTaskSearch([rows[1]], "work tag:work has:tags"), true);
  assert.equal(matchesTaskSearch([rows[1]], "label:work"), false);
  assert.equal(matchesTaskSearch([rows[0]], "tag:jira-only"), false);
  assert.equal(matchesTaskSearch([rows[2]], 'tag:"personal finance"'), true);
  const result = filterTaskGroups(groups, filters({ tagIds: ["work"], query: "release review" }));
  assert.deepEqual(result[0].matches.map(row => row.id), [2]);
  assert.equal(result[0].parent.id, 1);
  assert.equal(filterTaskGroups(groups, filters({ tagIds: ["missing"] })).length, 0);
});


test("multiple tag filters match any selected tag without duplicating tasks or selecting unrelated siblings", () => {
  const work = { id: "work", name: "Work", shortcut: "w" }, finance = { id: "finance", name: "Finance", shortcut: "f" };
  const rows = [
    task(1, { tags: [work] }),
    task(2, { parentKey: "KAN-1", tags: [finance] }),
    task(3, { parentKey: "KAN-1" }),
    task(4, { tags: [finance] }),
    task(5, { tags: [work, finance] }),
    task(6),
  ];
  const original = structuredClone(rows), groups = groupBoardTasks(rows);
  const matching = (tagIds) => filterTaskGroups(groups, filters({ tagIds })).flatMap((group) => group.matches.map((row) => row.id));
  assert.deepEqual(matching(["work", "finance"]), [1, 2, 4, 5]);
  assert.deepEqual(matching(["work", "finance", "work"]), [1, 2, 4, 5]);
  assert.deepEqual(matching(["finance"]), [2, 4, 5]);
  assert.deepEqual(matching(["work"]), [1, 5]);
  assert.deepEqual(matching([]), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rows, original);
});

test("multiple tags combine with search, priority and attention views while retaining a matching child's parent", () => {
  const work = { id: "work", name: "Work" }, personal = { id: "personal", name: "Personal" };
  const groups = groupBoardTasks([
    task(1, { title: "Release checklist", tags: [work], dueDate: "2026-11-01" }),
    task(2, { parentKey: "KAN-1", title: "Pay invoice", tags: [personal], priority: 2, dueDate: "2026-10-15", notifyAt: "2026-10-16T10:00:00Z" }),
    task(3, { parentKey: "KAN-1", tags: [work] }),
    task(4, { title: "Archived", tags: [personal], archived: true, dueDate: "2026-10-15", notifyAt: "2026-10-16T10:00:00Z" }),
  ]);
  for (const view of ["active", "overdue", "reminders"]) {
    const result = filterTaskGroups(groups, filters({ view, tagIds: ["work", "personal"], query: "release invoice", priority: "high" }), "2026-10-19");
    assert.equal(result.length, 1);
    assert.equal(result[0].parent.id, 1);
    assert.deepEqual(result[0].matches.map((row) => row.id), [2]);
  }
  const done = filterTaskGroups(groups, filters({ view: "done", tagIds: ["work", "personal"] }));
  assert.deepEqual(done.flatMap((group) => group.matches.map((row) => row.id)), [4]);
});


test("areas are exclusive across Active, Done, search, tags, Reminders and Overdue", () => {
  const work = { id: "work-tag", name: "Work" };
  const groups = groupBoardTasks([
    task(1, { title: "Shared search", areaId: "work", tags: [work], dueDate: "2026-10-01", notifyAt: "2026-10-01T10:00:00Z" }),
    task(2, { title: "Shared search", areaId: "personal", tags: [work], dueDate: "2026-10-01", notifyAt: "2026-10-01T10:00:00Z" }),
    task(3, { title: "Shared search", areaId: null, tags: [work] }),
    task(4, { title: "Shared search", areaId: "work", tags: [work], archived: true }),
    task(5, { title: "Shared search", areaId: "personal", tags: [work], archived: true }),
  ]);
  for (const view of ["active", "reminders", "overdue"]) {
    const selected = filterTaskGroups(groups, filters({ view, areaId: "work", query: "shared", tagIds: ["work-tag"] }), "2026-10-20");
    assert.deepEqual(selected.flatMap((group) => group.matches.map((row) => row.id)), [1]);
  }
  assert.deepEqual(filterTaskGroups(groups, filters({ view: "done", areaId: "work" })).map((group) => group.parent.id), [4]);
  assert.deepEqual(filterTaskGroups(groups, filters({ areaId: null })).map((group) => group.parent.id), [3]);
  assert.deepEqual(filterTaskGroups(groups, filters({ areaId: "" })).map((group) => group.parent.id), [3]);
  assert.equal(filterTaskGroups(groups, filters({ areaId: "learn" })).length, 0);
});

test("a parent and its subtasks stay in one area, including completed and matching child context", () => {
  const groups = groupBoardTasks([
    task(1, { areaId: "work" }),
    task(2, { parentKey: "KAN-1", areaId: "work", archived: true }),
    task(3, { parentKey: "KAN-1", areaId: "work", title: "Read reference" }),
  ]);
  assert.equal(filterTaskGroups(groups, filters({ areaId: "personal" })).length, 0);
  const work = filterTaskGroups(groups, filters({ areaId: "work", query: "reference" }));
  assert.equal(work[0].parent.id, 1);
  assert.deepEqual(work[0].matches.map((row) => row.id), [1, 2, 3]);
});
