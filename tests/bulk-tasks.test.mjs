import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { bulkTaskStatements, orderJiraDeletion, parseBulkTaskRequest } from "../lib/bulk-tasks.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY, status TEXT DEFAULT 'waiting', archived INTEGER DEFAULT 0,
      completed_at TEXT, manual_order INTEGER DEFAULT 2, notify_at TEXT DEFAULT '2030-01-01',
      notify_fired INTEGER DEFAULT 1, updated_at TEXT, notes TEXT DEFAULT 'Keep notes'
    );
    CREATE TABLE task_updates (task_id INTEGER REFERENCES tasks(id), body TEXT);
    INSERT INTO tasks (id) VALUES (1), (2), (3);
    INSERT INTO task_updates VALUES (1, 'First note'), (2, 'Second note'), (3, 'Unselected note');
  `);
  return db;
}

function execute(db, action, ids) {
  db.exec("BEGIN");
  try {
    for (const { sql, params } of bulkTaskStatements(action, ids, "2026-10-15T12:00:00.000Z")) {
      db.prepare(sql).run(...params);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("bulk requests reject invalid actions, empty selections and malformed IDs", () => {
  for (const payload of [null, {}, { action: "restore", ids: [1] },
    ...[[], [0], [-1], [1.5], ["1"], [null], [Number.MAX_SAFE_INTEGER + 1]].map((ids) => ({ action: "done", ids }))]) {
    assert.throws(() => parseBulkTaskRequest(payload));
  }
  assert.deepEqual(parseBulkTaskRequest({ action: "delete", ids: [1, 2, 1] }), { action: "delete", ids: [1, 2] });
});

test("bulk completion archives selected entries while preserving reminders and notes", () => {
  const db = fixture();
  try {
    execute(db, "done", [1, 2]);
    const rows = db.prepare("SELECT * FROM tasks ORDER BY id").all();
    for (const row of rows.slice(0, 2)) {
      assert.equal(row.status, "done");
      assert.equal(row.archived, 1);
      assert.equal(row.notify_at, "2030-01-01");
      assert.equal(row.notify_fired, 1);
      assert.equal(row.manual_order, null);
      assert.equal(row.completed_at, "2026-10-15T12:00:00.000Z");
      assert.equal(row.notes, "Keep notes");
    }
    assert.equal(rows[2].status, "waiting");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_updates").get().count, 3);
    db.prepare("UPDATE tasks SET completed_at = '2026-10-01' WHERE id = 1").run();
    execute(db, "done", [1]);
    assert.equal(db.prepare("SELECT completed_at FROM tasks WHERE id = 1").get().completed_at, "2026-10-01");
  } finally { db.close(); }
});

test("bulk deletion removes only selected entries and their history, including done entries", () => {
  const db = fixture();
  try {
    execute(db, "done", [1]);
    execute(db, "delete", [1, 2, 999]);
    assert.deepEqual(db.prepare("SELECT id FROM tasks").all().map((row) => row.id), [3]);
    assert.deepEqual(db.prepare("SELECT task_id FROM task_updates").all().map((row) => row.task_id), [3]);
  } finally { db.close(); }
});

test("bulk selection supports more than 100 entries", () => {
  const db = fixture();
  try {
    for (let id = 4; id <= 350; id++) db.prepare("INSERT INTO tasks (id) VALUES (?)").run(id);
    const ids = Array.from({ length: 350 }, (_, index) => index + 1);
    execute(db, "done", ids);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE archived = 1").get().count, 350);
    execute(db, "delete", ids);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 0);
  } finally { db.close(); }
});

test("failed deletion rolls back history removal with the batch", () => {
  const db = fixture();
  try {
    db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => execute(db, "delete", [1, 2]), /test failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_updates").get().count, 3);
  } finally { db.close(); }
});

test("large Jira deletions process selected children before parents across batch boundaries", () => {
  const rows = [
    { jira_key: "KAN-1", jira_parent_key: null },
    ...Array.from({ length: 24 }, (_, index) => ({ jira_key: `KAN-${index + 2}`, jira_parent_key: "KAN-1" })),
    { jira_key: "KAN-26", jira_parent_key: "KAN-2" },
    { jira_key: "KAN-27", jira_parent_key: "KAN-999" },
  ];
  const pending = new Map(rows.map((row) => [row.jira_key, row]));
  const ordered = orderJiraDeletion(rows);
  for (let index = 0; index < ordered.length; index += 20) {
    for (const row of ordered.slice(index, index + 20)) {
      assert.equal([...pending.values()].some((child) => child.jira_parent_key === row.jira_key), false);
      pending.delete(row.jira_key);
    }
  }
  assert.equal(pending.size, 0);
  assert.equal(ordered.some((row) => row.jira_key === "KAN-999"), false);
});
