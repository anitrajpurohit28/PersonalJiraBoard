import { ensureTaskSchema } from "./tasks";
import { storedTags } from "./jira-tags";
import { parseTag, tagOrderClause, type TaskTag } from "../lib/task-tags";
import { initializeJiraTags, changeJiraTags } from "../lib/jira-tag-sync";

export async function listTags(d1?: Awaited<ReturnType<typeof ensureTaskSchema>>) {
  const db = d1 || await ensureTaskSchema();
  return (await db.prepare(`SELECT id, name, shortcut FROM personal_tags ORDER BY ${tagOrderClause()}`).all<TaskTag>()).results;
}
export async function listTaskTags(taskId: number, d1: Awaited<ReturnType<typeof ensureTaskSchema>>) {
  return (await d1.prepare(`SELECT tags.id, tags.name, tags.shortcut FROM personal_tags AS tags JOIN personal_task_tags AS assigned ON assigned.tag_id = tags.id WHERE assigned.task_id = ? ORDER BY ${tagOrderClause("tags")}`).bind(taskId).all<TaskTag>()).results;
}
export async function saveTag(payload: unknown, id?: string) {
  const value = parseTag(payload), d1 = await initializeJiraTags(), current = await storedTags(d1);
  const old = current.find((tag) => tag.id === id);
  if (id && !old) throw Object.assign(new Error("Tag not found."), { status: 404 });
  if (current.some((tag) => tag.id !== id && (tag.name_key === value.nameKey || (value.shortcut && tag.shortcut === value.shortcut)))) throw Object.assign(new Error("A tag with this name or shortcut already exists."), { status: 409 });
  if (old && old.name === value.name) {
    await d1.prepare("UPDATE personal_tags SET shortcut = ? WHERE id = ?").bind(value.shortcut, old.id).run();
    return { tag: { id: old.id, name: old.name, shortcut: value.shortcut }, tags: await listTags(d1) };
  }
  const cloudId = old?.jira_tag_id || old?.id || crypto.randomUUID();
  await changeJiraTags("tags-upsert", { tag: { id: cloudId, name: value.name } });
  const saved = (await storedTags(d1)).find((tag) => tag.jira_tag_id === cloudId);
  if (!saved) throw new Error("The tag was saved in the sync queue, but its local copy needs a refresh.");
  await d1.prepare("UPDATE personal_tags SET shortcut = ? WHERE id = ?").bind(value.shortcut, saved.id).run();
  return { tag: { id: saved.id, name: value.name, shortcut: value.shortcut }, tags: await listTags(d1) };
}
export async function deleteTag(id: string) {
  const d1 = await initializeJiraTags(), tag = (await storedTags(d1)).find((tag) => tag.id === id);
  if (!tag) throw Object.assign(new Error("Tag not found."), { status: 404 });
  await changeJiraTags("tags-delete", { tagId: tag.jira_tag_id || tag.id });
}
