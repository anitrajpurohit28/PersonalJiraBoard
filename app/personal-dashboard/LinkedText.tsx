"use client";

import { useId, useState, type ReactNode } from "react";
import { textLinks } from "../../lib/text-links.mjs";

export function LinkedText({ text }: { text: string }) {
  return <>{textLinks(text).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)}</>;
}

// Native textareas cannot contain links. Keep links available while composing too.
export function DraftLinks({ text }: { text: string }) {
  const links = [...new Map(textLinks(text).filter((part) => part.href).map((part) => [part.href, part])).values()];
  return links.length ? <div className="draft-links" aria-label="Links in this field">{links.map((part) => <a key={part.href} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>)}</div> : null;
}

export function LinkedTextField({ label, value, onChange, required, disabled, extraHeader }: { extraHeader?: ReactNode; label: string; value: string; onChange: (value: string) => void; required: boolean; disabled: boolean }) {
  const id = useId();
  const [editing, setEditing] = useState(!value);
  const showEditor = editing || !value;
  return <div className="linked-text-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false); }}>
    <div className={`linked-text-heading${extraHeader ? " description-heading" : ""}`}><label htmlFor={showEditor ? id : undefined}>{label}</label>{extraHeader}{!showEditor ? <button type="button" disabled={disabled} onClick={() => setEditing(true)}>Edit {label.replace(/ \*$/, "").toLowerCase()}</button> : null}</div>
    {showEditor ? <><textarea id={id} aria-label={label} autoFocus={editing && Boolean(value)} rows={4} maxLength={32000} required={required} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /><DraftLinks text={value} /></> : <div className="linked-text-content"><LinkedText text={value} /></div>}
  </div>;
}
