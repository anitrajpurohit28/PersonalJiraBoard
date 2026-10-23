"use client";

import { useId } from "react";
import type { TaskTag } from "../../lib/task-tags";

export function TagFilters({ tags, selected, onToggle, onClear }: { tags: TaskTag[]; selected: string[]; onToggle: (id: string) => void; onClear: () => void }) {
  const helpId = useId();
  const stacks = Array.from({ length: Math.ceil(tags.length / 2) }, (_, index) => tags.slice(index * 2, index * 2 + 2));
  return <section className="toolbar-tags" aria-label="Filter by tags">
    <div className="tag-filter-heading">
      <span className="toolbar-label">Tags{selected.length ? <span className="tag-filter-count">{selected.length} selected</span> : null}</span>
      <button type="button" className="tag-filter-reset" aria-pressed={!selected.length} onClick={onClear} title="Clear tag filters and show all tags">All</button>
    </div>
    <div className="tag-filters" role="group" aria-label="Task tag filters" aria-describedby={helpId}>
      {stacks.map((stack) => <div className="tag-filter-stack" key={stack[0].id}>
        {stack.map((tag) => <button type="button" key={tag.id} aria-pressed={selected.includes(tag.id)} onClick={() => onToggle(tag.id)} title={tag.name}>
          <span className="tag-filter-check" aria-hidden="true">{selected.includes(tag.id) ? "✓" : ""}</span><span className="tag-filter-name">{tag.name}</span>
        </button>)}
      </div>)}
    </div>
    <span className="sr-only" id={helpId}>Show tasks that have every selected tag. All selected tags must be on the same task or subtask. Select All to clear the tag filters.</span>
  </section>;
}
