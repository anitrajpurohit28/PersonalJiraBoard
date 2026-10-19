import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { moveTaskBefore, parseTaskOrder, taskOrderStatements } from "../lib/task-order.ts";

test("drag ordering rejects malformed or duplicate IDs and invalid parent scopes", () => {
  for (const value of [null, {}, { ids: [1] }, { ids: [], parentKey: null }, ...[[0], [-1], [1.5], ["1"], [1, 1], [null]].map((ids) => ({ ids, parentKey: null }))]) {
    assert.throws(() => parseTaskOrder(value));
  }
  assert.deepEqual(parseTaskOrder({ ids: [3, 1, 2], parentKey: null }), { ids: [3, 1, 2], parentKey: null });
  assert.deepEqual(parseTaskOrder({ ids: [4, 5], parentKey: "KAN-1" }).ids, [4, 5]);
});

test("dragging moves up, down or to the bottom without dropping hidden siblings or mutating the source", () => {
  const ids = [1, 2, 3, 4, 5];
  assert.deepEqual(moveTaskBefore(ids, 4, 2), [1, 4, 2, 3, 5]);
  assert.deepEqual(moveTaskBefore(ids, 2, 5), [1, 3, 4, 2, 5]);
  assert.deepEqual(moveTaskBefore(ids, 2), [1, 3, 4, 5, 2]);
  assert.deepEqual(moveTaskBefore(ids, 3, 3), ids);
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
});

test("Jira and local manual positions survive database reopening without changing task fields or sibling orders", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "jira-order-"));
  const file = path.join(directory, "tasks.sqlite");
  let db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, source TEXT, title TEXT DEFAULT 'Keep title', status TEXT DEFAULT 'now', priority INTEGER DEFAULT 3, notify_at TEXT DEFAULT '2030-01-01', manual_order INTEGER);
      INSERT INTO tasks (id, source) VALUES (1, 'jira'), (2, 'manual'), (3, 'jira'), (4, 'jira'), (5, 'jira')`);
    for (const ids of [[3, 2, 1], [5, 4]]) for (const { sql, params } of taskOrderStatements(ids)) db.prepare(sql).run(...params);
    db.close(); db = new DatabaseSync(file);
    assert.deepEqual(db.prepare("SELECT id FROM tasks WHERE id <= 3 ORDER BY manual_order").all().map((row) => row.id), [3, 2, 1]);
    assert.deepEqual(db.prepare("SELECT id FROM tasks WHERE id > 3 ORDER BY manual_order").all().map((row) => row.id), [5, 4]);
    for (const row of db.prepare("SELECT * FROM tasks").all()) {
      assert.equal(row.title, "Keep title"); assert.equal(row.status, "now"); assert.equal(row.priority, 3); assert.equal(row.notify_at, "2030-01-01");
    }
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
