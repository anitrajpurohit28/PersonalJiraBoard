import rawSettings from "./ui.json" with { type: "json" };

export function validateUiSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "taskDetailsPosition") || !["center", "right"].includes(value.taskDetailsPosition)) throw new Error("config/ui.json: taskDetailsPosition must be center or right.");
  return Object.freeze({ taskDetailsPosition: value.taskDetailsPosition });
}
export const uiSettings = validateUiSettings(rawSettings);
