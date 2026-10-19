import { ensureTaskSchema } from "./tasks";
import { parseTag, tagOrderClause, tagCreationStatement, type TaskTag } from "../lib/task-tags";

export async function listTags(d1?: Awaited<ReturnType<typeof ensureTaskSchema>>) {
  const db = d1 || await ensureTaskSchema();
  return (await db.prepare(`SELECT id, name, shortcut FROM personal_tags ORDER BY ${tagOrderClause()}`).all<TaskTag>()).results;
}
export async function listTaskTags(taskId: number, d1: Awaited<ReturnType<typeof ensureTaskSchema>>) {
  return (await d1.prepare(`SELECT tags.id, tags.name, tags.shortcut FROM personal_tags AS tags JOIN personal_task_tags AS assigned ON assigned.tag_id = tags.id WHERE assigned.task_id = ? ORDER BY ${tagOrderClause("tags")}`).bind(taskId).all<TaskTag>()).results;
}
export async function saveTag(payload: unknown, id?: string) {
  const value = parseTag(payload);
  const d1 = await ensureTaskSchema();
  if (id && !await d1.prepare("SELECT id FROM personal_tags WHERE id = ?").bind(id).first()) throw Object.assign(new Error("Tag not found."), { status: 404 });
  const tagId = id || crypto.randomUUID();
  try {
    if (id) await d1.prepare("UPDATE personal_tags SET name = ?, name_key = ?, shortcut = ? WHERE id = ?").bind(value.name, value.nameKey, value.shortcut, id).run();
    else {
      const statement = tagCreationStatement(tagId, value);
      await d1.prepare(statement.sql).bind(...statement.params).run();
    }
  } catch (error) {
    if (/UNIQUE constraint failed/.test(String(error))) throw Object.assign(new Error("A tag with this name or shortcut already exists."), { status: 409 });
    throw error;
  }
  return { tag: { id: tagId, name: value.name, shortcut: value.shortcut }, tags: await listTags(d1) };
}
