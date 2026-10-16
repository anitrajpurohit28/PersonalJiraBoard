type ReminderTask = { id: number; notifyAt: string | null; notifyFired: boolean; archived: boolean };

export const hasFiredReminder = (task: Pick<ReminderTask, "notifyAt" | "notifyFired">) => Boolean(task.notifyAt && task.notifyFired);
export const reminderKey = (task: Pick<ReminderTask, "id" | "notifyAt">) => `${task.id}:${task.notifyAt}`;
export function remindersToFire<T extends ReminderTask>(tasks: T[], now = Date.now()): T[] {
  return tasks.filter((task) => !task.archived && !task.notifyFired && task.notifyAt && Number.isFinite(Date.parse(task.notifyAt)) && Date.parse(task.notifyAt) <= now);
}

// Only an explicit date change resets a reminder. SQL reads the current row, so
// an overlapping task save cannot undo a reminder that just fired.
export function reminderEdit(notifyAt: string | null | undefined) {
  return notifyAt === undefined ? { sql: "", params: [] } : {
    sql: "notify_fired = CASE WHEN ? IS NOT NULL AND (notify_at IS ? OR julianday(notify_at) = julianday(?)) THEN notify_fired ELSE 0 END, notify_at = ?",
    params: [notifyAt, notifyAt, notifyAt, notifyAt],
  };
}
export function fireReminderStatement(id: number, expectedNotifyAt: string, now = new Date().toISOString()) {
  return {
    sql: "UPDATE tasks SET notify_fired = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND notify_at = ? AND notify_fired = 0 AND archived = 0 AND julianday(notify_at) <= julianday(?)",
    params: [id, expectedNotifyAt, now],
  };
}
