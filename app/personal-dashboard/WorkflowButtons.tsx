"use client";
export function WorkflowButtons({ options, value, disabled, onChange }: { options: Array<{ id: string; name: string }>; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="workflow-field"><span id="workflow-status-label">Status</span><div className="status-switcher" role="group" aria-labelledby="workflow-status-label">{options.filter((option, index, all) => all.findIndex((entry) => entry.id === option.id) === index).map((option) => <button type="button" key={option.id} disabled={disabled} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>{option.name}</button>)}</div></div>;
}
