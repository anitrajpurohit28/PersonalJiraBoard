"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { checklistPlainText, descriptionChecklistRows, orderChecklist, parseDescriptionChecklist, writeDescriptionChecklist } from "../../lib/description-checklist.mjs";
import { DraftLinks, LinkedTextField } from "./LinkedText";

type Item = { id: string; text: string; done: boolean };
function initialModel(value: string) {
  const checklist = parseDescriptionChecklist(value);
  return { value, checklist: Boolean(checklist), rows: orderChecklist((checklist || []).map((row, index) => ({ ...row, id: `initial-${index}` }))) as Item[] };
}
export function DescriptionField({ label, value, onChange, required, disabled }: {
  label: string; value: string; onChange: (value: string) => void; required: boolean; disabled: boolean;
}) {
  const [model, setModel] = useState(() => initialModel(value));
  const pendingFocus = useRef<string | null>(null), inputs = useRef(new Map<string, HTMLInputElement>());
  const labelId = useId();
  // Reconcile only external values. Local edits keep stable row IDs through saves and sorting.
  if (model.value !== value) setModel(initialModel(value));
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    inputs.current.get(pendingFocus.current)?.focus(); pendingFocus.current = null;
  });
  function changeRows(rows: Item[]) {
    const ordered = orderChecklist(rows), next = writeDescriptionChecklist(ordered);
    setModel({ value: next, checklist: true, rows: ordered }); onChange(next);
  }
  function mode(checklist: boolean) {
    if (checklist === model.checklist) return;
    if (checklist) {
      const rows = descriptionChecklistRows(value).map(row => ({ ...row, id: crypto.randomUUID() }));
      pendingFocus.current = rows.find(row => !row.done)?.id || rows[0]?.id || null;
      changeRows(rows);
    } else {
      const next = checklistPlainText(value);
      setModel({ value: next, checklist: false, rows: [] }); onChange(next);
    }
  }
  function add(after?: string) {
    const row = { id: crypto.randomUUID(), text: "", done: false };
    const rows = [...model.rows];
    const index = after ? rows.findIndex(item => item.id === after) : -1;
    rows.splice(index < 0 ? rows.findIndex(item => item.done) < 0 ? rows.length : rows.findIndex(item => item.done) : index + 1, 0, row);
    pendingFocus.current = row.id; changeRows(rows);
  }
  function remove(id: string) {
    const rows = model.rows.filter(row => row.id !== id);
    if (!rows.length) rows.push({ id: crypto.randomUUID(), text: "", done: false });
    changeRows(rows);
  }
  const controls = <div className="description-format" role="group" aria-label="Description format"><button type="button" aria-pressed={!model.checklist} disabled={disabled} onClick={() => mode(false)}>Text</button><button type="button" aria-pressed={model.checklist} disabled={disabled} onClick={() => mode(true)}>To-do list</button></div>;
  if (!model.checklist) return <LinkedTextField label={label} value={value} required={required} disabled={disabled} extraHeader={controls} onChange={(next) => { setModel({ value: next, checklist: false, rows: [] }); onChange(next); }} />;
  const empty = !model.rows.some(row => row.text.trim());
  return <section className="description-checklist" aria-labelledby={labelId}>
    <div className="linked-text-heading"><span id={labelId} className="description-label">{label}</span>{controls}</div>
    <div className="description-checklist-items">{model.rows.map((row, index) => <div key={row.id} className={`description-checklist-row${row.done ? " checklist-done" : ""}`}>
      <input type="checkbox" aria-label={`${row.done ? "Reopen" : "Complete"} ${row.text || `checklist item ${index + 1}`}`} checked={row.done} disabled={disabled || !row.text.trim()} onChange={(event) => changeRows(model.rows.map(item => item.id === row.id ? { ...item, done: event.target.checked } : item))} />
      <div className="checklist-item-content"><input ref={(node) => { if (node) inputs.current.set(row.id, node); else inputs.current.delete(row.id); }} type="text" aria-label={`Checklist item ${index + 1}`} placeholder="Write an item…" value={row.text} required={required && empty && index === 0} disabled={disabled} maxLength={Math.max(0, 32000 - (value.length - row.text.length))} onChange={(event) => changeRows(model.rows.map(item => item.id === row.id ? { ...item, text: event.target.value } : item))} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); add(row.id); }
      }} onPaste={(event) => {
        const pasted = event.clipboardData.getData("text").replace(/\r\n?/g, "\n");
        if (!pasted.includes("\n")) return;
        const input = event.currentTarget, before = row.text.slice(0, input.selectionStart ?? 0), after = row.text.slice(input.selectionEnd ?? row.text.length);
        const lines = `${before}${pasted}${after}`.split("\n");
        const additions = lines.map((text, position) => ({ id: position ? crypto.randomUUID() : row.id, text, done: row.done }));
        const rows = [...model.rows]; rows.splice(index, 1, ...additions);
        if (writeDescriptionChecklist(rows).length > 32000) return;
        event.preventDefault(); pendingFocus.current = additions.at(-1)!.id; changeRows(rows);
      }} /><DraftLinks text={row.text} /></div>
      <button type="button" className="checklist-remove" aria-label={`Remove checklist item ${index + 1}`} title="Remove item" disabled={disabled || (model.rows.length === 1 && !row.text)} onClick={() => remove(row.id)}>×</button>
    </div>)}</div>
    <button type="button" className="checklist-add" disabled={disabled || value.length > 31990} onClick={() => add()}>+ Add item</button>
  </section>;
}
