import type { JiraEditorContext, JiraField, JiraSession, Task } from "./task-types";

// Show the cached task on the first render, before requesting current edit permissions.
export function cachedTaskEditor(task: Task | undefined, session?: JiraSession | null): JiraEditorContext | null {
  if (!task) return null;
  const schema = session?.editorSchemas?.[`${task.projectId}:${task.issueTypeId}`];
  const field = (fieldId: string, name: string, type = "string"): JiraField => ({ fieldId, name, required: fieldId === "summary", hasDefaultValue: false, schema: { type }, allowedValues: [] });
  const fields = schema || [
    field("summary", "Summary"), field("description", "Description"),
    { ...field("priority", "Priority", "priority"), allowedValues: session?.metadata?.priorities || (task.jiraPriorityId ? [{ id: task.jiraPriorityId, name: task.jiraPriority || "Medium" }] : []) },
    field("duedate", "Due date", "date"), field("parent", "Parent"),
    { ...field("labels", "Labels", "array"), schema: { type: "array", items: "string" } },
  ];
  const statuses = session?.metadata?.columns?.flatMap((column) => column.statuses) || [];
  const currentStatus = statuses.find((status) => status.id === task.jiraStatusId);
  return {
    fields, accountId: session?.accountId || "", offline: !session?.connected,
    transitions: statuses.map((status) => ({ id: `cached-${status.id}`, name: status.name, to: status, fields: [] })),
    issue: { key: task.jiraKey, fields: {
      summary: task.title, description: task.description, priority: { id: task.jiraPriorityId, name: task.jiraPriority },
      status: { id: task.jiraStatusId, name: currentStatus?.name || task.state, statusCategory: { key: task.archived ? "done" : "indeterminate" } },
      parent: task.parentKey ? { key: task.parentKey } : null, duedate: task.dueDate, labels: task.labels,
      project: { id: task.projectId, key: task.projectKey }, issuetype: { id: task.issueTypeId, name: task.issueType, subtask: task.isSubtask }, updated: task.jiraUpdatedAt,
    } },
  };
}
