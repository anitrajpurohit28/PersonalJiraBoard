import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { personalTagSchema, parseTag, parseTagIds, tagForShortcut, taskTagAliasStatements, taskTagAssignment, tagCreationStatement, tagOrderClause, tagOrderMigration, parseTagOrder, tagOrderStatements } from "../lib/task-tags.ts";
import { jiraCacheChanges } from "../lib/jira-cache-changes.mjs";

function database(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, jira_key TEXT UNIQUE, source TEXT DEFAULT 'jira', notes TEXT DEFAULT '', jira_parent_key TEXT);
    CREATE TABLE IF NOT EXISTS task_updates (task_id INTEGER, body TEXT);
    CREATE TABLE IF NOT EXISTS jira_task_aliases (local_key TEXT PRIMARY KEY, jira_key TEXT);
    CREATE TABLE IF NOT EXISTS jira_deleted_tasks (jira_key TEXT PRIMARY KEY)`);
  for (const sql of personalTagSchema) db.exec(sql);
  return db;
}
function add(db, id, name, shortcut = "") {
  const parsed = parseTag({ name, shortcut });
  const change = tagCreationStatement(id, parsed);
  db.prepare(change.sql).run(...change.params);
}
function assign(db, task, tag, assigned = true) {
  const change = taskTagAssignment(task, tag, assigned);
  db.prepare(change.sql).run(...change.params);
}
const assigned = (db, task) => db.prepare("SELECT tag_id FROM personal_task_tags WHERE task_id = ? ORDER BY tag_id").all(task).map(row => row.tag_id);

test("personal tags accept custom names and optional single-key shortcuts", () => {
  assert.deepEqual(parseTag({ name: "  Personal  finance ", shortcut: " W " }), { name: "Personal finance", nameKey: "personal finance", shortcut: "w" });
  for (const name of ["Work", "Finance", "A", "B", "C", "80% returns", "A-Imp_critical", "日本語"]) assert.equal(parseTag({ name }).name, name);
  for (const shortcut of ["j", "p", "f", "l", "1", "2", "3", "-", "="]) assert.equal(parseTag({ name: "Example", shortcut }).shortcut, shortcut);
  for (const payload of [null, {}, { name: " " }, { name: "a".repeat(61) }, { name: "Work", shortcut: {} }, ...["cmd+w", "ww", "a", "c", "q", "v", "x", "z"].map(shortcut => ({ name: "Work", shortcut }))]) assert.throws(() => parseTag(payload));
});

test("tag names and shortcuts are unique, while many tags can have no shortcut", () => {
  const db = database();
  try {
    add(db, "work", "Work", "w");
    assert.throws(() => add(db, "other-work", "WORK"));
    assert.throws(() => add(db, "same-key", "Personal", "w"));
    add(db, "a", "A"); add(db, "b", "B");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_tags").get().count, 3);
  } finally { db.close(); }
});

test("Cmd/Ctrl shortcuts match only assigned keys, avoid typing, repeats and standard edit shortcuts", () => {
  const tags = [{ id: "work", name: "Work", shortcut: "w" }, { id: "finance", name: "Finance", shortcut: "f" }];
  const event = { key: "w", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(tagForShortcut(tags, event).id, "work");
  assert.equal(tagForShortcut(tags, { ...event, key: "W", metaKey: false, ctrlKey: true }).id, "work");
  for (const change of [{ metaKey: false }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }, { key: "q" }, { key: "a" }, { key: "s" }]) assert.equal(tagForShortcut(tags, { ...event, ...change }), undefined);
});

test("task tags persist across reopening, rename everywhere and add idempotently without changing other tags", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "personal-tags-"));
  const file = path.join(dir, "tasks.sqlite");
  let db = database(file);
  try {
    db.exec("INSERT INTO tasks (id, jira_key) VALUES (1, 'KAN-1'), (2, 'KAN-2')");
    add(db, "work", "Work", "w"); add(db, "personal", "Personal", "p");
    assign(db, 1, "work"); assign(db, 1, "work"); assign(db, 1, "personal"); assign(db, 2, "work");
    assert.deepEqual(assigned(db, 1), ["personal", "work"]);
    db.prepare("UPDATE personal_tags SET name = 'Organization', name_key = 'organization', shortcut = 'o' WHERE id = 'work'").run();
    db.close(); db = database(file);
    assert.deepEqual(assigned(db, 1), ["personal", "work"]);
    assert.equal(db.prepare("SELECT tags.name FROM personal_tags tags JOIN personal_task_tags assigned ON tags.id = assigned.tag_id WHERE task_id = 2").get().name, "Organization");
    assign(db, 1, "work", false);
    assert.deepEqual(assigned(db, 1), ["personal"]);
    assert.deepEqual(assigned(db, 2), ["work"]);
    assert.throws(() => assign(db, 99, "work"));
    assert.throws(() => assign(db, 1, "missing"));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("offline key replacement merges tags from both cache entries without losing private tags", () => {
  const db = database();
  const local = "local:00000000-0000-4000-8000-000000000001";
  try {
    db.prepare("INSERT INTO tasks (id, jira_key) VALUES (1, ?), (2, 'KAN-10')").run(local);
    add(db, "work", "Work", "w"); add(db, "personal", "Personal", "p");
    assign(db, 1, "work"); assign(db, 2, "work"); assign(db, 2, "personal");
    for (const change of [...taskTagAliasStatements(local, "KAN-10"), ...jiraCacheChanges({ [local]: "KAN-10" })]) db.prepare(change.sql).run(...change.params);
    assert.equal(db.prepare("SELECT jira_key FROM tasks WHERE id = 1").get().jira_key, "KAN-10");
    assert.deepEqual(assigned(db, 1), ["personal", "work"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
  } finally { db.close(); }
});

test("deleting a tag removes its assignments but preserves tasks and other tags", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key) VALUES (1, 'KAN-1'), (2, 'KAN-2')");
    add(db, "work", "Work", "w"); add(db, "personal", "Personal", "p");
    assign(db, 1, "work"); assign(db, 1, "personal"); assign(db, 2, "work");
    db.exec("DELETE FROM personal_tags WHERE id = 'work'");
    assert.deepEqual(assigned(db, 1), ["personal"]);
    assert.deepEqual(assigned(db, 2), []);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 2);
    db.exec("DELETE FROM tasks WHERE id = 1");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_task_tags").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_tags").get().count, 1);
  } finally { db.close(); }
});

test("tag assignments reject malformed or duplicate identifiers", () => {
  assert.deepEqual(parseTagIds(["work", "tag-1"]), ["work", "tag-1"]);
  assert.deepEqual(parseTagIds([]), []);
  for (const value of [null, "work", ["work", "work"], [""], [1], ["a/b"], ["a".repeat(81)]]) assert.throws(() => parseTagIds(value));
});


const catalogOrder = (db) => db.prepare(`SELECT id, name, shortcut FROM personal_tags ORDER BY ${tagOrderClause()}`).all();
function reorder(db, ids) {
  const parsed = parseTagOrder({ ids }, catalogOrder(db).map(tag => tag.id));
  db.exec("BEGIN");
  try {
    for (const change of tagOrderStatements(parsed)) db.prepare(change.sql).run(...change.params);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

test("tag ordering rejects malformed and stale lists instead of dropping tags", () => {
  assert.deepEqual(parseTagOrder({ ids: ["work", "personal"] }, ["personal", "work"]), ["work", "personal"]);
  assert.deepEqual(parseTagOrder({ ids: [] }, []), []);
  for (const value of [null, {}, { ids: "work" }, { ids: ["work", "work"] }, { ids: [1] }]) assert.throws(() => parseTagOrder(value, ["work", "personal"]));
  for (const ids of [[], ["work"], ["work", "missing"], ["work", "personal", "finance"]]) assert.throws(() => parseTagOrder({ ids }, ["work", "personal"]), error => error.status === 409);
});

test("custom tag order survives reopening and is used for both parent and subtask tags", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "personal-tag-order-"));
  const file = path.join(dir, "tasks.sqlite");
  let db = database(file);
  try {
    db.exec("INSERT INTO tasks (id, jira_key, jira_parent_key) VALUES (1, 'KAN-1', NULL), (2, 'KAN-2', 'KAN-1')");
    add(db, "work", "Work", "w"); add(db, "personal", "Personal", "p"); add(db, "finance", "Finance", "f");
    for (const taskId of [1, 2]) for (const id of ["personal", "work", "finance"]) assign(db, taskId, id);
    reorder(db, ["work", "finance", "personal"]);
    db.close(); db = database(file);
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["work", "finance", "personal"]);
    for (const taskId of [1, 2]) {
      const rows = db.prepare(`SELECT tags.id FROM personal_tags tags JOIN personal_task_tags assigned ON assigned.tag_id = tags.id WHERE task_id = ? ORDER BY ${tagOrderClause("tags")}`).all(taskId);
      assert.deepEqual(rows.map(row => row.id), ["work", "finance", "personal"]);
    }
    assert.equal(tagForShortcut(catalogOrder(db), { key: "w", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }).id, "work");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_task_tags").get().count, 6);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("new tags append after the chosen order and renaming or deleting tags preserves the remaining order", () => {
  const db = database();
  try {
    add(db, "work", "Work", "w"); add(db, "personal", "Personal", "p"); add(db, "finance", "Finance", "f");
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["work", "personal", "finance"]);
    reorder(db, ["finance", "work", "personal"]);
    add(db, "alpha", "A");
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["finance", "work", "personal", "alpha"]);
    db.prepare("UPDATE personal_tags SET name = 'Z Work', name_key = 'z work' WHERE id = 'work'").run();
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["finance", "work", "personal", "alpha"]);
    db.exec("DELETE FROM personal_tags WHERE id = 'work'");
    add(db, "beta", "B");
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["finance", "personal", "alpha", "beta"]);
  } finally { db.close(); }
});

test("upgrading existing tags keeps their alphabetical display, shortcuts and assignments before a custom order is chosen", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE tasks (id INTEGER PRIMARY KEY);
      CREATE TABLE personal_tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, shortcut TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO tasks VALUES (1);
      INSERT INTO personal_tags (id, name, name_key, shortcut) VALUES ('work', 'Work', 'work', 'w'), ('personal', 'Personal', 'personal', 'p'), ('finance', 'Finance', 'finance', 'f')`);
    for (const sql of personalTagSchema) db.exec(sql);
    assign(db, 1, "work");
    assert.equal(db.prepare("PRAGMA table_info(personal_tags)").all().some(row => row.name === "sort_order"), false);
    db.exec(tagOrderMigration);
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["finance", "personal", "work"]);
    reorder(db, ["work", "finance", "personal"]);
    assert.deepEqual(catalogOrder(db).map(tag => tag.id), ["work", "finance", "personal"]);
    assert.deepEqual(assigned(db, 1), ["work"]);
    assert.equal(catalogOrder(db)[0].shortcut, "w");
  } finally { db.close(); }
});
