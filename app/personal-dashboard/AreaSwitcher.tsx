"use client";
import type { TaskArea } from "../../lib/task-areas";

export function AreaSwitcher({ areas, value, onChange, onManage, managed, counts }: { areas: TaskArea[]; counts: ReadonlyMap<string, number>; managed?: boolean; value: string; onChange: (id: string) => void; onManage: () => void }) {
  return <nav className="area-switcher" aria-label="Areas">
    <div className="area-options" role="group" aria-label="Choose area">
      <button type="button" aria-pressed={!value} onClick={() => onChange("")}><span>Unassigned ({counts.get("") || 0})</span></button>
      {areas.map((area) => <button type="button" key={area.id} title={area.name} aria-pressed={value === area.id} onClick={() => onChange(area.id)}><span>{area.name} ({counts.get(area.id) || 0})</span></button>)}
    </div>
    <button type="button" className="area-manage" onClick={onManage} aria-label="Manage areas" title={managed ? "View Jira Area choices" : "Create, rename or remove areas"}>{managed ? "Areas" : "+ Area"}</button>
  </nav>;
}
