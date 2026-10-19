import type { TaskTag } from "./task-tags";

export type Status = "now" | "waiting" | "later" | "confirmation" | "done";
export type Priority = 1 | 2 | 3 | 4;
export type TaskComment = { id: string; body: string; author: string; createdAt: string; updatedAt: string; pending: boolean };
export type Task = {
  id: number;
  jiraKey: string;
  jiraUrl: string;
  title: string;
  priority: Priority;
  status: Status;
  source: "manual" | "jira";
  state: string | null;
  jiraPriority: string | null;
  jiraAssignee: string | null;
  jiraStatusId: string | null;
  description: string;
  jiraPriorityId: string | null;
  jiraAssigneeId: string | null;
  projectId: string | null;
  projectKey: string | null;
  issueTypeId: string | null;
  issueType: string | null;
  parentKey: string | null;
  dueDate: string | null;
  labels: string[];
  tags: TaskTag[];
  jiraUpdatedAt: string | null;
  syncStatus: string; syncError: string; isSubtask: boolean;
  comments: TaskComment[];
  notes: string;
  notifyAt: string | null;
  notifyFired: boolean;
  manualOrder: number | null;
  archived: boolean;
  completedAt: string | null;
  createdAt: string;
  jiraCreatedAt: string | null;
  updatedAt: string;
  updates: Array<{ id: number; body: string; createdAt: string }>;
};
export const COLUMNS: Array<{ id: Exclude<Status, "done">; label: string }> = [
  { id: "now", label: "Now" }, { id: "waiting", label: "Waiting" },
  { id: "later", label: "Later" }, { id: "confirmation", label: "Review" },
];
export const PRIORITIES: Record<Priority, string> = { 1: "High", 2: "High", 3: "Medium", 4: "Low" };
export const PRIORITY_OPTIONS = [2, 3, 4].map((priority) => ({ id: String(priority), name: PRIORITIES[priority as Priority] }));

export type JiraField = { fieldId: string; name: string; required: boolean; hasDefaultValue: boolean; defaultValue?: unknown; schema: { type?: string; items?: string; custom?: string }; allowedValues: Array<string | { id?: string; value?: string; name?: string; children?: Array<{ id: string; value: string }> }> };
export type JiraTransition = { id: string; name: string; to: { id: string; name: string; category?: string }; fields: JiraField[] };
export type JiraEditorContext = {
  projects?: Array<{ id: string; key: string; name: string }>; project?: { id: string; key: string; name: string };
  issueTypes?: Array<{ id: string; name: string; subtask: boolean }>; issueType?: { id: string; name: string; subtask: boolean };
  fields: JiraField[]; accountId: string; transitions?: JiraTransition[]; offline?: boolean;
  issue?: { key: string; fields: Record<string, unknown> };
  subtasks?: Array<{ key: string; summary: string; status: string; syncStatus: string }>;
};
export type JiraColumn = { id: string; name: string; done: boolean; statuses: Array<{ id: string; name: string; category?: string }> };
export type SyncEntry = { id: string; key: string; type: string; label: string; title: string; status: string; error: string; createdAt: string; conflicts: Array<{ field: string; local: string; remote: string }> };
export type SyncQueue = { pending: number; attention: number; revision: number; lastSyncedAt: string | null; entries: SyncEntry[] };
export type JiraSession = { connected: boolean; availableOffline?: boolean; paused?: boolean; syncing?: boolean; phase: string; message: string; hasCredential?: boolean; credentialSource?: string; accountId?: string; editorSchemas?: Record<string, JiraField[]>; queue?: SyncQueue; metadata?: { boardName?: string; projects?: Array<{ id: string; key: string; name: string }>; columns?: JiraColumn[]; priorities?: Array<{ id: string; name: string }> } };
