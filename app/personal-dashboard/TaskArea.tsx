"use client";
import { useId } from "react";
import { areaColor } from "../../config/ui-settings.mjs";
import type { TaskArea as Area } from "../../lib/task-areas";

export function TaskArea({ areas, value, inherited, disabled, onChange, onManage }: { areas: Area[]; value: string | null; inherited?: boolean; disabled: boolean; onChange: (id: string | null) => void; onManage: () => void }) {
  const id = useId();
  return <section className="task-area-section" aria-label="Task area" data-area-color={areaColor(areas.find((area) => area.id === value)?.name)}>
    <div className="section-heading"><label htmlFor={id}><span className="area-dot" aria-hidden="true" />Area</label><button type="button" disabled={disabled} onClick={onManage}>Manage areas</button></div>
    <select id={id} value={value || ""} disabled={disabled || inherited} onChange={(event) => onChange(event.target.value || null)}><option value="">Unassigned</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
    {inherited ? <p className="muted">Follows the parent task. Moving the parent moves all its subtasks.</p> : null}
  </section>;
}
