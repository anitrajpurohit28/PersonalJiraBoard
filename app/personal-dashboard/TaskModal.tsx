"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { DetailPosition } from "./useDetailPosition";

export function TaskModal({ title, children, onClose, busy, position = "center", onTogglePosition }: { title: string; children: ReactNode; onClose: () => void; busy: boolean; position?: DetailPosition; onTogglePosition?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`task-modal task-modal-${position}`} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target !== event.currentTarget || busy) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }}><div className="modal-content"><header><h2>{title}</h2><div className="modal-header-actions">{onTogglePosition ? <button type="button" className="layout-toggle" disabled={busy} onClick={onTogglePosition} aria-label={`Move task details to ${position === "right" ? "the center" : "the right side"}`}>{position === "right" ? "Center" : "Right side"}</button> : null}<button type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div></header>{children}</div></dialog>;
}
export function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
