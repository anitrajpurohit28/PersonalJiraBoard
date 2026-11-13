"use client";

import { useId, useState, type ReactNode } from "react";
import { LocalFileLink } from "./LocalFiles";
import { localFileTextParts } from "../../lib/local-file-references.mjs";
import { textLinks } from "../../lib/text-links.mjs";

export function LinkedText({ text }: { text: string }) {
  return <>{localFileTextParts(text).map((part, index) => part.fileUrl ? <LocalFileLink key={index} url={part.fileUrl} /> : <span key={index}>{textLinks(part.text).map((link,i)=>link.href ? <a key={i} href={link.href} target="_blank" rel="noopener noreferrer">{link.text}</a> : link.text)}</span>)}</>;
}

// Native textareas cannot contain links. Keep links available while composing too.
export function DraftLinks({ text }: { text: string }) {
  const links = [...new Map(textLinks(text).filter((part) => part.href).map((part) => [part.href, part])).values()];
  const files=[...new Set(localFileTextParts(text).flatMap(part=>part.fileUrl?[part.fileUrl]:[]))];
  return links.length || files.length ? <div className="draft-links" aria-label="Links in this field">{files.map(url=><LocalFileLink key={url} url={url} />)}{links.map((part) => <a key={part.href} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>)}</div> : null;
}

export function LinkedTextField({ label, value, onChange, required, disabled, extraHeader, preserveEditing = false }: { preserveEditing?: boolean; extraHeader?: ReactNode; label: string; value: string; onChange: (value: string) => void; required: boolean; disabled: boolean }) {
  const id = useId();
  const [editing, setEditing] = useState(!value);
  const showEditor = editing || !value;
  return <div className="linked-text-field" onBlur={(event) => { if (!preserveEditing && !event.currentTarget.contains(event.relatedTarget)) setEditing(false); }}>
    <div className={`linked-text-heading${extraHeader ? " description-heading" : ""}`}><label htmlFor={showEditor ? id : undefined}>{label}</label>{extraHeader}{!showEditor ? <button type="button" disabled={disabled} onClick={() => setEditing(true)}>Edit {label.replace(/ \*$/, "").toLowerCase()}</button> : null}</div>
    {showEditor ? <><textarea id={id} aria-label={label} autoFocus={editing && Boolean(value)} rows={4} maxLength={32000} required={required} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /><DraftLinks text={value} /></> : <div className="linked-text-content"><LinkedText text={value} /></div>}
  </div>;
}
