"use client";
import type { TaskArea } from "../../lib/task-areas";

export function AreaSwitcher({ areas, value, onChange, onManage }: { areas: TaskArea[]; value: string; onChange: (id: string) => void; onManage: () => void }) {
  return <nav className="area-switcher" aria-label="Areas">
    <div className="area-options" role="group" aria-label="Choose area">
      <button type="button" aria-pressed={!value} onClick={() => onChange("")}>Unassigned</button>
      {areas.map((area) => <button type="button" key={area.id} title={area.name} aria-pressed={value === area.id} onClick={() => onChange(area.id)}>{area.name}</button>)}
    </div>
    <button type="button" className="area-manage" onClick={onManage} aria-label="Manage areas" title="Create, rename or remove areas">+ Area</button>
  </nav>;
}
