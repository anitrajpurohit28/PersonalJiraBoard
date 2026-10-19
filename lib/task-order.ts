export function moveTaskBefore(ids: number[], id: number, before?: number): number[] {
  if (id === before) return [...ids];
  const ordered = ids.filter((value) => value !== id);
  const index = before === undefined ? -1 : ordered.indexOf(before);
  ordered.splice(index < 0 ? ordered.length : index, 0, id);
  return ordered;
}

export function parseTaskOrder(payload: unknown): { ids: number[]; parentKey: string | null } {
  if (!payload || typeof payload !== "object") throw new Error("The card order is invalid.");
  const { ids, parentKey } = payload as Record<string, unknown>;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length || (parentKey !== null && (typeof parentKey !== "string" || !parentKey || parentKey.length > 100))) {
    throw new Error("The card order is invalid.");
  }
  return { ids, parentKey };
}

export function taskOrderStatements(ids: number[]) {
  return ids.map((id, index) => ({ sql: "UPDATE tasks SET manual_order = ? WHERE id = ?", params: [index, id] }));
}
