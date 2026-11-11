"use client";
import { TaskDateField } from "./TaskDateField";
export function ReminderField({ value, onChange, fired, disabled }: { value: string; onChange: (value: string) => void; fired: boolean; disabled: boolean; formId?: string }) {
  return <section className={`reminder-field ${fired ? "reminder-fired" : ""}`} aria-label="Task reminder"><TaskDateField label="Reminder" value={value} onChange={onChange} withTime disabled={disabled} />{fired ? <small className="reminder-fired-message" role="status">Reminder fired. Clear it or choose a new time to reset it.</small> : null}</section>;
}
