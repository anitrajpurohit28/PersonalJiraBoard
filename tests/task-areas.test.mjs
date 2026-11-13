import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { personalAreaSchema, parseArea, parseAreaId, areaCreationStatement, areaMoveStatements, resolvedTaskAreas, taskAreaAliasStatements, initialTaskAreaStatement, areaChoices, parseAreaOrder, areaOrderStatements, moveAreaChoice } from "../lib/task-areas.ts";
import { jiraCacheChanges } from "../lib/jira-cache-changes.mjs";

function database(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, jira_key TEXT UNIQUE, source TEXT DEFAULT 'jira', notes TEXT DEFAULT '', jira_parent_key TEXT, archived INTEGER DEFAULT 0, priority INTEGER DEFAULT 3);
    CREATE TABLE IF NOT EXISTS task_updates (task_id INTEGER, body TEXT);
    CREATE TABLE IF NOT EXISTS jira_task_aliases (local_key TEXT PRIMARY KEY, jira_key TEXT);
    CREATE TABLE IF NOT EXISTS jira_deleted_tasks (jira_key TEXT PRIMARY KEY)`);
  for (const sql of personalAreaSchema) db.exec(sql);
  return db;
}
function add(db, id, name) { const change = areaCreationStatement(id, parseArea({ name })); db.prepare(change.sql).run(...change.params); }
function rows(db) { return db.prepare(`SELECT tasks.id, tasks.jira_key AS jiraKey, tasks.jira_parent_key AS parentKey, assigned.area_id AS areaId FROM tasks LEFT JOIN personal_task_areas AS assigned ON assigned.task_id = tasks.id ORDER BY tasks.id`).all(); }
function move(db, ids, area) {
  const result = areaMoveStatements(rows(db), ids, area);
  db.exec("BEGIN");
  try { for (const change of result.statements) db.prepare(change.sql).run(...change.params); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  return result.ids;
}
const areaIds = (db) => [...resolvedTaskAreas(rows(db))].sort((a, b) => a[0] - b[0]);

test("areas accept user names, normalize duplicates and reserve Unassigned", () => {
  assert.deepEqual(parseArea({ name: "  Personal   Finance " }), { name: "Personal Finance", nameKey: "personal finance" });
  for (const name of ["Work", "Personal", "Learn", "日本語"]) assert.equal(parseArea({ name }).name, name);
  for (const value of [null, {}, { name: " " }, { name: "a".repeat(61) }, { name: "Unassigned" }, { name: "unASSIGNED" }, { name: "Work\u0001Area" }]) assert.throws(() => parseArea(value));
  assert.equal(parseAreaId(null), null); assert.equal(parseAreaId(""), null); assert.equal(parseAreaId("my-area-1"), "my-area-1");
  for (const id of [undefined, 1, {}, "a/b", "a".repeat(81)]) assert.throws(() => parseAreaId(id));
});

test("upgrading existing tasks leaves them Unassigned and preserves their content; area names are unique", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key, notes) VALUES (1, 'KAN-1', 'Keep this note'), (2, 'KAN-2', '')");
    for (const sql of personalAreaSchema) db.exec(sql);
    assert.deepEqual(areaIds(db), [[1, null], [2, null]]);
    add(db, "work", "Work"); add(db, "personal", "Personal"); add(db, "learn", "Learn");
    assert.throws(() => add(db, "duplicate", "WORK"));
    db.exec("UPDATE personal_areas SET name = 'Learning', name_key = 'learning' WHERE id = 'learn'");
    assert.deepEqual(db.prepare("SELECT id FROM personal_areas ORDER BY sort_order").all().map((row) => row.id), ["work", "personal", "learn"]);
    assert.equal(db.prepare("SELECT notes FROM tasks WHERE id = 1").get().notes, "Keep this note");
  } finally { db.close(); }
});

test("moving a parent or any child moves the complete group to exactly one area, without changing Jira fields", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key, jira_parent_key, archived, priority) VALUES (1, 'KAN-1', NULL, 0, 2), (2, 'KAN-2', 'KAN-1', 1, 3), (3, 'KAN-3', 'KAN-1', 0, 4), (4, 'KAN-4', NULL, 0, 3)");
    add(db, "work", "Work"); add(db, "personal", "Personal");
    const before = db.prepare("SELECT * FROM tasks ORDER BY id").all();
    assert.deepEqual(move(db, [2, 1, 2], "work"), [1, 2, 3]);
    assert.deepEqual(areaIds(db), [[1, "work"], [2, "work"], [3, "work"], [4, null]]);
    move(db, [1], "personal");
    assert.deepEqual(areaIds(db), [[1, "personal"], [2, "personal"], [3, "personal"], [4, null]]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_task_areas").get().count, 3);
    move(db, [3], null);
    assert.deepEqual(areaIds(db), [[1, null], [2, null], [3, null], [4, null]]);
    assert.deepEqual(db.prepare("SELECT * FROM tasks ORDER BY id").all(), before);
  } finally { db.close(); }
});

test("area membership survives restart and newly synced subtasks inherit their parent's area", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "personal-area-test-")), file = path.join(directory, "tasks.sqlite");
  let db = database(file);
  try {
    db.exec("INSERT INTO tasks (id, jira_key) VALUES (1, 'KAN-1'), (2, 'KAN-2')");
    add(db, "work", "Work"); move(db, [1], "work"); db.close(); db = database(file);
    db.exec("INSERT INTO tasks (id, jira_key, jira_parent_key, archived) VALUES (3, 'KAN-3', 'KAN-1', 1)");
    assert.deepEqual(areaIds(db), [[1, "work"], [2, null], [3, "work"]]);
    db.exec("UPDATE tasks SET jira_parent_key = 'KAN-2' WHERE id = 3");
    assert.deepEqual(areaIds(db), [[1, "work"], [2, null], [3, null]]);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("orphaned siblings and parent cycles resolve consistently and move together", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key, jira_parent_key) VALUES (1, 'KAN-1', 'KAN-99'), (2, 'KAN-2', 'KAN-99'), (3, 'KAN-3', 'KAN-4'), (4, 'KAN-4', 'KAN-3')");
    add(db, "work", "Work");
    assert.deepEqual(move(db, [2], "work"), [1, 2]);
    assert.deepEqual(move(db, [4], "work"), [3, 4]);
    assert.deepEqual(areaIds(db), [[1, "work"], [2, "work"], [3, "work"], [4, "work"]]);
  } finally { db.close(); }
});

test("invalid or stale bulk selections cannot partially change areas", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key) VALUES (1, 'KAN-1')"); add(db, "work", "Work");
    for (const ids of [null, [], [0], ["1"], [1, 999]]) assert.throws(() => move(db, ids, "work"));
    assert.throws(() => move(db, [1], "missing-area"));
    assert.deepEqual(areaIds(db), [[1, null]]);
  } finally { db.close(); }
});

test("removing an area returns its tasks to Unassigned without deleting tasks, notes or other areas", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key, notes) VALUES (1, 'KAN-1', 'Private note'), (2, 'KAN-2', '')");
    add(db, "work", "Work"); add(db, "personal", "Personal");
    move(db, [1], "work"); move(db, [2], "personal");
    db.exec("DELETE FROM personal_areas WHERE id = 'work'");
    assert.deepEqual(areaIds(db), [[1, null], [2, "personal"]]);
    assert.equal(db.prepare("SELECT notes FROM tasks WHERE id = 1").get().notes, "Private note");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 2);
    db.exec("DELETE FROM tasks WHERE id = 2");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_task_areas").get().count, 1);
  } finally { db.close(); }
});

test("offline-to-Jira aliases preserve an area and an explicit move back to Unassigned", () => {
  const local = "local:00000000-0000-4000-8000-000000000001";
  for (const localArea of ["work", null, undefined]) {
    const db = database();
    try {
      db.prepare("INSERT INTO tasks (id, jira_key) VALUES (1, ?), (2, 'KAN-10')").run(local);
      add(db, "work", "Work"); add(db, "personal", "Personal");
      move(db, [2], "personal");
      if (localArea !== undefined) move(db, [1], localArea);
      for (const change of [...taskAreaAliasStatements(local, "KAN-10"), ...jiraCacheChanges({ [local]: "KAN-10" })]) db.prepare(change.sql).run(...change.params);
      assert.deepEqual(areaIds(db), [[1, localArea === undefined ? "personal" : localArea]]);
      assert.equal(db.prepare("SELECT jira_key FROM tasks WHERE id = 1").get().jira_key, "KAN-10");
    } finally { db.close(); }
  }
});


test("creation retries do not overwrite a later area move, including Unassigned", () => {
  const db = database();
  try {
    db.exec("INSERT INTO tasks (id, jira_key) VALUES (1, 'KAN-1')"); add(db, "work", "Work"); add(db, "learn", "Learn");
    const initial = initialTaskAreaStatement(1, "work");
    db.prepare(initial.sql).run(...initial.params);
    assert.deepEqual(areaIds(db), [[1, "work"]]);
    for (const destination of ["learn", null]) {
      move(db, [1], destination);
      db.prepare(initial.sql).run(...initial.params);
      assert.deepEqual(areaIds(db), [[1, destination]]);
    }
  } finally { db.close(); }
});

function orderedChoices(db){return areaChoices(db.prepare('SELECT id,name,sort_order AS sortOrder FROM personal_areas ORDER BY sort_order,name_key,id').all()).map(area=>area.id);}
function reorder(db,ids){const current=db.prepare('SELECT id FROM personal_areas').all().map(area=>area.id);const valid=parseAreaOrder({ids},current);db.exec('BEGIN');try{for(const change of areaOrderStatements(valid))db.prepare(change.sql).run(...change.params);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
test('Area drag order, including Unassigned, survives reopening without changing task ownership',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'area-order-')),file=path.join(directory,'tasks.sqlite');let db=database(file);
 try{
  add(db,'work','Work');add(db,'personal','Personal');add(db,'learn','Learn');db.exec("INSERT INTO tasks(id,jira_key,notes) VALUES(1,'KAN-1','Keep me')");move(db,[1],'work');
  const tasks=db.prepare('SELECT * FROM tasks').all(),assigned=areaIds(db);
  assert.deepEqual(orderedChoices(db),['','work','personal','learn']);
  reorder(db,['learn','','personal','work']);assert.deepEqual(orderedChoices(db),['learn','','personal','work']);
  db.close();db=database(file);assert.deepEqual(orderedChoices(db),['learn','','personal','work']);
  assert.deepEqual(db.prepare('SELECT * FROM tasks').all(),tasks);assert.deepEqual(areaIds(db),assigned);
  reorder(db,['work','learn','personal','']);add(db,'finance','Finance');assert.deepEqual(orderedChoices(db),['work','learn','personal','','finance']);
  db.exec("UPDATE personal_areas SET name='Learning',name_key='learning' WHERE id='learn'");assert.deepEqual(orderedChoices(db),['work','learn','personal','','finance']);
  db.exec("DELETE FROM personal_areas WHERE id='personal'");assert.deepEqual(orderedChoices(db),['work','learn','','finance']);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
test('Area reordering rejects malformed/stale lists without losing areas or their existing order',()=>{
 const db=database();try{add(db,'work','Work');add(db,'learn','Learn');
 for(const ids of [null,[],['work','learn'],['','work'],['','work','learn','new'],['','work','work'],['',null,'learn'],['','../work','learn']]){assert.throws(()=>reorder(db,ids));assert.deepEqual(orderedChoices(db),['','work','learn']);}
 assert.deepEqual(parseAreaOrder({ids:['']},[]),['']);assert.deepEqual(areaOrderStatements(['']),[]);
 }finally{db.close();}
});
test('Area drag placement works on either side and keeps invalid/self drops unchanged',()=>{
 const ids=['','work','personal','learn'];
 assert.deepEqual(moveAreaChoice(ids,'learn','work',false),['','learn','work','personal']);
 assert.deepEqual(moveAreaChoice(ids,'','learn',true),['work','personal','learn','']);
 assert.equal(moveAreaChoice(ids,'work','work',true),ids);assert.equal(moveAreaChoice(ids,'missing','work',false),ids);
});
