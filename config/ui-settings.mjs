import rawSettings from "./ui.json" with { type: "json" };

const defaultStatusOrder = ["Inbox", "Now", "Parked", "Almost Done", "Done"];
const defaultPriorityOrder = ["Low", "Medium", "High"];
function validateOrder(value, key, fallback) {
  const names = value === undefined ? fallback : value;
  if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== "string" || !name.trim()) || new Set(names.map((name) => name.trim().toLowerCase())).size !== names.length) throw new Error(`config/ui.json: ${key} must contain unique, nonempty names.`);
  return Object.freeze(names.map((name) => name.trim()));
}
export function validateUiSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["taskDetailsPosition", "statusOrder", "priorityOrder"].includes(key)) || !["center", "right"].includes(value.taskDetailsPosition)) throw new Error("config/ui.json: taskDetailsPosition must be center or right.");
  const statusOrder = validateOrder(value.statusOrder, "statusOrder", defaultStatusOrder);
  const priorityOrder = validateOrder(value.priorityOrder, "priorityOrder", defaultPriorityOrder);
  if (priorityOrder.length !== 3 || priorityOrder.some((name) => !defaultPriorityOrder.some((priority) => priority.toLowerCase() === name.toLowerCase()))) throw new Error("config/ui.json: priorityOrder must contain Low, Medium and High once each.");
  return Object.freeze({ taskDetailsPosition: value.taskDetailsPosition, statusOrder, priorityOrder });
}
/**
 * @template {{name: string}} T
 * @param {T[]} options
 * @param {readonly string[]} order
 * @returns {T[]}
 */
export function orderNamedOptions(options, order) {
  const ranks = new Map(order.map((name, index) => [name.trim().toLowerCase(), index]));
  const rank = (option) => ranks.get(option.name.trim().toLowerCase()) ?? order.length;
  return [...options].sort((left, right) => rank(left) - rank(right));
}
export const uiSettings = validateUiSettings(rawSettings);
