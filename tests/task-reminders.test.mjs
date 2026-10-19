import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { clearCompletedReminders, fireReminderStatement, hasFiredReminder, reminderEdit, reminderKey, remindersToFire } from "../lib/task-reminders.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE tasks (id INTEGER PRIMARY KEY, notify_at TEXT, notify_fired INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, updated_at TEXT)");
  db.prepare("INSERT INTO tasks (id, notify_at) VALUES (1, ?)").run("2026-10-16T05:00:00.000Z");
  return db;
}
function edit(db, date) {
  const change = reminderEdit(date);
  if (change.sql) db.prepare(`UPDATE tasks SET ${change.sql} WHERE id = 1`).run(...change.params);
}
function fire(db, date = "2026-10-16T05:00:00.000Z") {
  const change = fireReminderStatement(1, date, "2026-10-16T06:00:00.000Z");
  return db.prepare(change.sql).run(...change.params).changes;
}

test("firing is atomic across multiple windows and does not clear the reminder", () => {
  const db = database();
  try {
    assert.equal(fire(db), 1); assert.equal(fire(db), 0);
    const row = db.prepare("SELECT * FROM tasks").get();
    assert.equal(row.notify_at, "2026-10-16T05:00:00.000Z"); assert.equal(row.notify_fired, 1);
  } finally { db.close(); }
});

test("unrelated saves and equivalent timestamps preserve fired state; explicit rescheduling or clearing resets it", () => {
  const db = database();
  try {
    fire(db);
    for (const value of [undefined, "2026-10-16T05:00:00.000Z", "2026-10-16T10:30:00+05:30"]) {
      edit(db, value);
      assert.equal(db.prepare("SELECT notify_fired FROM tasks").get().notify_fired, 1);
    }
    edit(db, "2026-10-16T05:30:00.000Z");
    assert.equal(db.prepare("SELECT notify_fired FROM tasks").get().notify_fired, 0);
    assert.equal(fire(db, "2026-10-16T05:30:00.000Z"), 1);
    edit(db, null);
    const row = db.prepare("SELECT * FROM tasks").get();
    assert.equal(row.notify_at, null); assert.equal(row.notify_fired, 0);
  } finally { db.close(); }
});

test("an in-flight firing cannot mark a rescheduled reminder; future and completed reminders do not fire", () => {
  const db = database();
  try {
    edit(db, "2026-10-17T05:00:00.000Z");
    assert.equal(fire(db), 0);
    assert.equal(fire(db, "2026-10-17T05:00:00.000Z"), 0);
    edit(db, "2026-10-16T05:30:00.000Z");
    db.exec("UPDATE tasks SET archived = 1");
    assert.equal(fire(db, "2026-10-16T05:30:00.000Z"), 0);
  } finally { db.close(); }
});

test("only due, active, unfired reminders are eligible, and the same task can fire again after rescheduling", () => {
  const task = { id: 1, notifyAt: "2026-10-16T05:00:00.000Z", notifyFired: false, archived: false };
  const now = Date.parse("2026-10-16T06:00:00.000Z");
  const rows = [task, { ...task, id: 2, notifyAt: null }, { ...task, id: 3, notifyAt: "bad" }, { ...task, id: 4, notifyFired: true }, { ...task, id: 5, archived: true }, { ...task, id: 6, notifyAt: "2030-01-01" }];
  assert.deepEqual(remindersToFire(rows, now).map((row) => row.id), [1]);
  assert.equal(hasFiredReminder({ ...task, notifyFired: true }), true);
  assert.equal(hasFiredReminder({ ...task, notifyFired: true, notifyAt: null }), false);
  const next = { ...task, notifyAt: "2026-10-16T05:30:00.000Z" };
  assert.notEqual(reminderKey(task), reminderKey(next));
  assert.equal(remindersToFire([next], now).length, 1);
});


test("single completion clears both future and fired reminders, and late edits cannot restore them", () => {
  for (const fired of [0, 1]) {
    const db = database();
    try {
      db.prepare("UPDATE tasks SET notify_fired = ?").run(fired);
      const change = reminderEdit(undefined, true);
      db.prepare(`UPDATE tasks SET archived = 1, ${change.sql}`).run(...change.params);
      edit(db, "2030-01-01"); // An overlapping autosave from another window.
      let row = db.prepare("SELECT * FROM tasks").get();
      assert.equal(row.notify_at, null); assert.equal(row.notify_fired, 0);
      db.exec("UPDATE tasks SET archived = 0");
      edit(db, undefined);
      assert.equal(db.prepare("SELECT notify_at FROM tasks").get().notify_at, null);
      const restore = reminderEdit("2030-01-01", false);
      db.prepare(`UPDATE tasks SET ${restore.sql}`).run(...restore.params);
      row = db.prepare("SELECT * FROM tasks").get();
      assert.equal(row.notify_at, "2030-01-01"); assert.equal(row.notify_fired, 0);
    } finally { db.close(); }
  }
});

test("upgrade cleanup removes old completed reminders and leaves active reminders untouched", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, archived, notify_at, notify_fired) VALUES (2, 1, '2030-01-01', 1), (3, 1, NULL, 1)");
    db.exec(clearCompletedReminders); db.exec(clearCompletedReminders);
    const rows = db.prepare("SELECT * FROM tasks ORDER BY id").all();
    assert.equal(rows[0].notify_at, "2026-10-16T05:00:00.000Z");
    for (const row of rows.slice(1)) { assert.equal(row.notify_at, null); assert.equal(row.notify_fired, 0); }
    assert.equal(hasFiredReminder({ notifyAt: '2030-01-01', notifyFired: true, archived: true }), false);
  } finally { db.close(); }
});
