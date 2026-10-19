"use client";
import type { TaskTag } from "../../lib/task-tags";
import { useTagShortcuts } from "./useTagShortcuts";

export function TaskTags({ tags, selected, onChange, onManage, disabled = false, shortcutsEnabled = true }: {
  tags: TaskTag[]; selected: string[]; onChange: (id: string, assigned: boolean) => void; onManage: () => void; disabled?: boolean; shortcutsEnabled?: boolean;
}) {
  useTagShortcuts(tags, shortcutsEnabled, (id) => { if (!selected.includes(id)) onChange(id, true); });
  return <section className="task-tags-section" aria-label="Task tags">
    <div className="section-heading"><h3>Tags</h3><button type="button" onClick={onManage}>Manage tags</button></div>
    {tags.length ? <div className="task-tag-options" role="group" aria-label="Tags for this task">{tags.map((tag) => <button type="button" key={tag.id} aria-pressed={selected.includes(tag.id)} disabled={disabled} onClick={() => onChange(tag.id, !selected.includes(tag.id))} title={tag.shortcut ? `${tag.name} · Cmd/Ctrl + ${tag.shortcut.toUpperCase()}` : tag.name}>{tag.name}{tag.shortcut ? <kbd>{tag.shortcut.toUpperCase()}</kbd> : null}</button>)}</div> : <p className="muted">Create a tag with Manage tags.</p>}
  </section>;
}
