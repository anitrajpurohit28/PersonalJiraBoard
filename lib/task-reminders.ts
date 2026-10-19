type ReminderTask = { id: number; notifyAt: string | null; notifyFired: boolean; archived: boolean };

export const hasFiredReminder = (task: Pick<ReminderTask, "notifyAt" | "notifyFired" | "archived">) => Boolean(!task.archived && task.notifyAt && task.notifyFired);
export const reminderKey = (task: Pick<ReminderTask, "id" | "notifyAt">) => `${task.id}:${task.notifyAt}`;
export function remindersToFire<T extends ReminderTask>(tasks: T[], now = Date.now()): T[] {
  return tasks.filter((task) => !task.archived && !task.notifyFired && task.notifyAt && Number.isFinite(Date.parse(task.notifyAt)) && Date.parse(task.notifyAt) <= now);
}

// Changing the date or completing the task resets its reminder. SQL reads the
// current row so an overlapping save cannot restore a completed reminder.
export function reminderEdit(notifyAt: string | null | undefined, completed?: boolean) {
  if (completed) notifyAt = null;
  const active = completed === undefined ? "archived = 0" : completed ? "0" : "1";
  return notifyAt === undefined ? { sql: "", params: [] } : {
    sql: `notify_fired = CASE WHEN ${active} AND ? IS NOT NULL AND (notify_at IS ? OR julianday(notify_at) = julianday(?)) THEN notify_fired ELSE 0 END, notify_at = CASE WHEN ${active} THEN ? ELSE NULL END`,
    params: [notifyAt, notifyAt, notifyAt, notifyAt],
  };
}
export function fireReminderStatement(id: number, expectedNotifyAt: string, now = new Date().toISOString()) {
  return {
    sql: "UPDATE tasks SET notify_fired = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND notify_at = ? AND notify_fired = 0 AND archived = 0 AND julianday(notify_at) <= julianday(?)",
    params: [id, expectedNotifyAt, now],
  };
}

export const clearCompletedReminders = "UPDATE tasks SET notify_at = NULL, notify_fired = 0 WHERE archived = 1 AND (notify_at IS NOT NULL OR notify_fired <> 0)";
