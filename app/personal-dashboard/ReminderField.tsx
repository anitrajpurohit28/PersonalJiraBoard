"use client";
export function ReminderField({ value, onChange, fired, disabled, formId }: { value: string; onChange: (value: string) => void; fired: boolean; disabled: boolean; formId?: string }) {
  return <section className={`reminder-field ${fired ? "reminder-fired" : ""}`} aria-label="Task reminder">
    <label>Reminder<input form={formId} type="datetime-local" value={value} disabled={disabled} onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => onChange(event.target.value)} /></label>
    {value ? <div className="reminder-actions">{fired ? <span role="status">Reminder fired. Clear it or choose a new time to reset it.</span> : null}<button type="button" disabled={disabled} onClick={() => onChange("")}>Clear reminder</button></div> : null}
  </section>;
}
