import { parseTaskId } from "../../../../../db/tasks";
import { initializeJiraTags, changeJiraTags } from "../../../../../lib/jira-tag-sync";
import { storedTags } from "../../../../../db/jira-tags";
import { listTaskTags } from "../../../../../db/tags";
import { assertLocalMutation, errorResponse } from "../../../../../lib/local-request";
import { parseTagIds, taskTagAssignment } from "../../../../../lib/task-tags";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalMutation(request);
    const id = parseTaskId((await context.params).id);
    if (!id) return Response.json({ error: "Invalid task id." }, { status: 400 });
    const payload = await request.json();
    const [tagId] = parseTagIds([payload.tagId]);
    if (typeof payload.assigned !== "boolean") return Response.json({ error: "Choose whether to add or remove this tag." }, { status: 400 });
    const d1 = await initializeJiraTags();
    const task = await d1.prepare("SELECT jira_key, source FROM tasks WHERE id = ?").bind(id).first<{ jira_key: string; source: string }>();
    if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
    const tag = (await storedTags(d1)).find((tag) => tag.id === tagId);
    if (!tag) return Response.json({ error: "Tag not found." }, { status: 404 });
    if (task.source === "jira") await changeJiraTags("tags-assign", { key: task.jira_key, tagId: tag.jira_tag_id || tag.id, assigned: payload.assigned });
    else {
      const change = taskTagAssignment(id, tagId, payload.assigned);
      await d1.prepare(change.sql).bind(...change.params).run();
    }
    return Response.json({ tags: await listTaskTags(id, d1) });
  } catch (error) { return errorResponse(error, "Unable to update task tags."); }
}
