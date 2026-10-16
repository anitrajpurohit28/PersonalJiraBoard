"use client";
import { useId } from "react";

export function ChoiceButtons({ label, options, value, onChange, disabled = false, compact = false }: {
  label: string; options: Array<{ id: string; name: string }>; value: string; onChange: (value: string) => void; disabled?: boolean; compact?: boolean;
}) {
  const labelId = useId();
  return <div className={`choice-field ${compact ? "choice-compact" : ""}`}><span id={labelId}>{label}</span><div className="choice-buttons" role="group" aria-labelledby={labelId}>{options.map((option) => <button type="button" key={option.id} aria-pressed={value === option.id} disabled={disabled} onClick={() => onChange(option.id)}>{option.name}</button>)}</div></div>;
}
