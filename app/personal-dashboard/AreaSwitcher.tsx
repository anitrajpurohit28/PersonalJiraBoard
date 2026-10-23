"use client";
import { areaColor } from "../../config/ui-settings.mjs";
import type { TaskArea } from "../../lib/task-areas";

export function AreaSwitcher({ areas, value, onChange, onManage }: { areas: TaskArea[]; value: string; onChange: (id: string) => void; onManage: () => void }) {
  return <nav className="area-switcher" aria-label="Areas">
    <div className="area-options" role="group" aria-label="Choose area">
      <button type="button" data-area-color="neutral" aria-pressed={!value} onClick={() => onChange("")}><span className="area-dot" aria-hidden="true" /><span>Unassigned</span></button>
      {areas.map((area) => <button type="button" key={area.id} title={area.name} data-area-color={areaColor(area.name)} aria-pressed={value === area.id} onClick={() => onChange(area.id)}><span className="area-dot" aria-hidden="true" /><span>{area.name}</span></button>)}
    </div>
    <button type="button" className="area-manage" onClick={onManage} aria-label="Manage areas" title="Create, rename or remove areas">+ Area</button>
  </nav>;
}
