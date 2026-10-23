import { storageNamespace } from "../config/settings.mjs";
import { uiSettings } from "../config/ui-settings.mjs";

export type Theme = "light" | "dark";
export const defaultTheme = uiSettings.theme as Theme;
export const themeStorageKey = `${storageNamespace}-theme`;
// Run in the head so a saved dark theme is applied before the first paint.
export const themeBootstrap = `(()=>{let theme=${JSON.stringify(defaultTheme)};try{const saved=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(saved==="light"||saved==="dark")theme=saved;}catch{}document.documentElement.dataset.theme=theme;})();`;
