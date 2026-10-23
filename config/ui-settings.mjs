import rawSettings from "./ui.json" with { type: "json" };

const areaPalette = Object.freeze(["blue", "green", "grey", "purple", "amber", "teal", "rose"]);
const areaNameKey = (name) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const defaultStatusOrder = ["Inbox", "Now", "Parked", "Almost Done", "Done"];
const defaultPriorityOrder = ["Low", "Medium", "High"];
function validateOrder(value, key, fallback) {
  const names = value === undefined ? fallback : value;
  if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== "string" || !name.trim()) || new Set(names.map((name) => name.trim().toLowerCase())).size !== names.length) throw new Error(`config/ui.json: ${key} must contain unique, nonempty names.`);
  return Object.freeze(names.map((name) => name.trim()));
}
export function validateUiSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["taskDetailsPosition", "statusOrder", "priorityOrder", "areaColors", "theme"].includes(key)) || !["center", "right"].includes(value.taskDetailsPosition)) throw new Error("config/ui.json: taskDetailsPosition must be center or right.");
  const theme = value.theme === undefined ? "light" : value.theme;
  if (!["light", "dark"].includes(theme)) throw new Error("config/ui.json: theme must be light or dark.");
  const statusOrder = validateOrder(value.statusOrder, "statusOrder", defaultStatusOrder);
  const priorityOrder = validateOrder(value.priorityOrder, "priorityOrder", defaultPriorityOrder);
  if (priorityOrder.length !== 3 || priorityOrder.some((name) => !defaultPriorityOrder.some((priority) => priority.toLowerCase() === name.toLowerCase()))) throw new Error("config/ui.json: priorityOrder must contain Low, Medium and High once each.");
  const colors = value.areaColors ?? {};
  if (typeof colors !== "object" || Array.isArray(colors) || Object.entries(colors).some(([name, color]) => !areaNameKey(name) || !areaPalette.includes(color)) || new Set(Object.keys(colors).map(areaNameKey)).size !== Object.keys(colors).length) throw new Error("config/ui.json: areaColors must map unique area names to blue, green, grey, purple, amber, teal or rose.");
  return Object.freeze({ taskDetailsPosition: value.taskDetailsPosition, theme, statusOrder, priorityOrder, areaColors: Object.freeze(Object.fromEntries(Object.entries(colors).map(([name, color]) => [areaNameKey(name), color]))) });
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
/** The same Area keeps its color across devices, restarts and list changes.
 * @param {string | null | undefined} name
 * @param {Readonly<Record<string, string>>} colors
 */
export function areaColor(name, colors = uiSettings.areaColors) {
  const key = areaNameKey(name || "");
  if (!key) return "neutral";
  if (Object.hasOwn(colors, key)) return colors[key];
  let hash = 0;
  for (const character of key) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return areaPalette[hash % areaPalette.length];
}
