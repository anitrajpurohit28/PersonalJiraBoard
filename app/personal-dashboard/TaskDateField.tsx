"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { defaultReminderParts, daysInMonth, formatReminderDisplay, formatReminderTimeDisplay, from12Hour, pad2, parseLocalValue, parseReminderDisplay, parseReminderTimeText, partsToLocalValue, to12Hour, type ReminderParts, type ReminderPeriod } from "../../lib/task-date-picker";

// Calendar/time layout and draft-until-Done behavior match the companion board's picker.
export function TaskDateField({ label, value, onChange, withTime = false, disabled = false, required = false }: {
  label: string; value: string; onChange: (value: string) => void; withTime?: boolean; disabled?: boolean; required?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const hours = useRef<HTMLDivElement>(null), minutes = useRef<HTMLDivElement>(null), id = useId();
  const committed = parseLocalValue(value);
  const display = (parts: ReminderParts | null) => withTime ? formatReminderDisplay(parts) : parts ? `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}` : "";
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<ReminderParts | null>(null);
  const [text, setText] = useState(() => display(committed)), [timeText, setTimeText] = useState(() => formatReminderTimeDisplay(committed));
  const [view, setView] = useState(() => committed || defaultReminderParts()), [error, setError] = useState("");
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const active = draft || committed || defaultReminderParts();
  const period = to12Hour(active.hour);
  function sync(parts: ReminderParts) { setDraft(parts); setText(display(parts)); setTimeText(formatReminderTimeDisplay(parts)); setError(""); }
  function show() { if (disabled) return; const seed = committed || defaultReminderParts(); sync(seed); setView(seed); setPosition(null); setOpen(true); }
  function discard() { setOpen(false); setDraft(null); setText(display(committed)); setTimeText(formatReminderTimeDisplay(committed)); setError(""); }
  function update(patch: Partial<ReminderParts>) { sync({ ...active, ...patch }); }
  function commit(override?: ReminderParts) {
    const date = override || parseReminderDisplay(text);
    const time = parseReminderTimeText(timeText);
    if (!date || (!override && withTime && !time)) { setError(withTime ? "Enter a valid date and time, for example 25/12/2026, 09:30 AM." : "Enter a valid date, for example 25/12/2026."); return; }
    const next = withTime && !override && time ? { ...date, ...time } : date;
    const local = partsToLocalValue(next);
    onChange(withTime ? local : local.slice(0, 10)); setOpen(false); setDraft(null); setError(""); toggle.current?.focus({ preventScroll: true });
  }
  function applyTime() { const parsed = parseReminderTimeText(timeText); if (parsed) update(parsed); else setError("Enter a time such as 09:30 AM."); }
  function month(delta: number) { const date = new Date(view.year, view.month - 1 + delta, 1); setView({ ...view, year: date.getFullYear(), month: date.getMonth() + 1 }); }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setDraft(null); setError(""); } };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const field = root.current?.querySelector(".reminder-picker-field")?.getBoundingClientRect(), bounds = popup.current?.getBoundingClientRect();
      if (!field || !bounds) return;
      const left = Math.max(8, Math.min(field.left, window.innerWidth - bounds.width - 8));
      const top = Math.max(8, Math.min(field.bottom + 6, window.innerHeight - bounds.height - 8));
      setPosition(current => current?.top === top && current?.left === left ? current : { left, top });
    }
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, view.year, view.month, withTime, error]);
  useLayoutEffect(() => {
    if (!open || !withTime) return;
    for (const [list, selected] of [[hours.current, '[aria-selected="true"]'], [minutes.current, '[aria-selected="true"]']] as const) {
      const option = list?.querySelector<HTMLElement>(selected);
      if (option && list) list.scrollTop = option.offsetTop - (list.clientHeight - option.offsetHeight) / 2;
    }
  }, [open, active.hour, active.minute, withTime]);
  const shown = open ? text : display(committed);
  return <div ref={root} className={`task-date-field${withTime ? "" : " date-only"}`} onKeyDownCapture={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); discard(); toggle.current?.focus({ preventScroll: true }); } }}>
    <label className="date-field-label" htmlFor={id}>{label}{required ? " *" : ""}</label>
    <div className="date-field-row"><div className="reminder-picker-field">
      <input id={id} className="reminder-datetime" type="text" role="combobox" aria-controls={`${id}-popup`} autoComplete="off" placeholder={withTime ? "dd/mm/yyyy, hh:mm AM" : "dd/mm/yyyy"} value={shown} disabled={disabled} aria-label={withTime ? "Reminder date and time" : "Due date"} aria-expanded={open} aria-haspopup="dialog" onFocus={() => { if (!open) show(); }} onChange={(event) => {
        setText(event.target.value); setError(""); const parsed = parseReminderDisplay(event.target.value); if (parsed) { setDraft(parsed); if (withTime) setTimeText(formatReminderTimeDisplay(parsed)); }
      }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const parsed = parseReminderDisplay(text); if (parsed) commit(parsed); else commit(); } }} />
      <button ref={toggle} className="reminder-picker-toggle" type="button" aria-label={`Open ${label.toLowerCase()} calendar`} aria-expanded={open} disabled={disabled} onClick={() => open ? discard() : show()}>▾</button>
    </div><button type="button" className="date-field-clear" disabled={disabled || !value || required} onClick={() => { onChange(""); discard(); }}>Clear {label.toLowerCase()}</button></div>
    {open ? <div ref={popup} id={`${id}-popup`} role="dialog" aria-label={`Choose ${label.toLowerCase()}${withTime ? " date and time" : ""}`} className="reminder-popover" style={{ ...position, visibility: position ? "visible" : "hidden" }}>
      <fieldset disabled={disabled} className="reminder-popover-body">
        <div className="reminder-calendar"><div className="reminder-calendar-nav"><button type="button" aria-label="Previous month" onClick={() => month(-1)}>‹</button><span>{new Date(view.year, view.month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" })}</span><button type="button" aria-label="Next month" onClick={() => month(1)}>›</button></div>
          <div className="reminder-calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={index}>{day}</span>)}</div>
          <div className="reminder-calendar-grid">{Array.from({ length: new Date(view.year, view.month - 1, 1).getDay() }, (_, index) => <span key={`pad-${index}`} />)}{Array.from({ length: daysInMonth(view.year, view.month) }, (_, index) => <button key={index} type="button" className="reminder-day" aria-label={new Date(view.year, view.month - 1, index + 1).toLocaleDateString(undefined, { dateStyle: "full" })} aria-pressed={active.year === view.year && active.month === view.month && active.day === index + 1} onClick={() => update({ year: view.year, month: view.month, day: index + 1 })}>{index + 1}</button>)}</div>
        </div>
        {withTime ? <div className="reminder-time-panel">
          <div className="reminder-time-nudge"><button type="button" aria-label="Hour up" disabled={active.hour >= 23} onClick={() => update({ hour: active.hour + 1 })}>▲</button><button type="button" aria-label="Minute up" disabled={active.minute >= 59} onClick={() => update({ minute: active.minute + 1 })}>▲</button></div>
          <div className="reminder-time-cols"><div ref={hours} className="reminder-time-list" role="listbox" aria-label="Hours 1 to 12">{Array.from({ length: 12 }, (_, index) => <button key={index} type="button" role="option" aria-selected={period.hour12 === index + 1} onClick={() => update({ hour: from12Hour(index + 1, period.period) })}>{pad2(index + 1)}</button>)}</div><div ref={minutes} className="reminder-time-list" role="listbox" aria-label="Minutes 0 to 59">{Array.from({ length: 60 }, (_, index) => <button key={index} type="button" role="option" aria-selected={active.minute === index} onClick={() => update({ minute: index })}>{pad2(index)}</button>)}</div></div>
          <div className="reminder-time-nudge"><button type="button" aria-label="Hour down" disabled={active.hour <= 0} onClick={() => update({ hour: active.hour - 1 })}>▼</button><button type="button" aria-label="Minute down" disabled={active.minute <= 0} onClick={() => update({ minute: active.minute - 1 })}>▼</button></div>
          <div className="reminder-period-toggle" role="group" aria-label="AM or PM">{(["AM", "PM"] as ReminderPeriod[]).map(item => <button type="button" key={item} aria-pressed={period.period === item} onClick={() => update({ hour: from12Hour(period.hour12, item) })}>{item}</button>)}</div>
        </div> : null}
      </fieldset>
      <div className="reminder-popover-footer">{withTime ? <label className="reminder-time-type">Time<input type="text" autoComplete="off" aria-label="Type reminder time" placeholder="hh:mm AM" value={timeText} disabled={disabled} onChange={(event) => { setTimeText(event.target.value); setError(""); }} onBlur={applyTime} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyTime(); } }} /></label> : null}<button type="button" className="primary reminder-popover-done" disabled={disabled} onClick={() => commit()}>Done</button></div>
      {error ? <p className="date-picker-error" role="alert">{error}</p> : null}
    </div> : null}
  </div>;
}
