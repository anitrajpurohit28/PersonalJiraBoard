import rawSettings from "./app.json" with { type: "json" };

import { validateSettings, configurationFor } from "../lib/app-config.mjs";
export { validateSettings };
export const settings = validateSettings(rawSettings);
export const { configurationId, storageNamespace } = configurationFor(settings);
export const configuredUrl = new URL(settings.jiraUrl);
export const configuredCloudId = configuredUrl.searchParams.get("cloudId");
export const configuredSite = configuredUrl.hostname.endsWith(".atlassian.net") ? configuredUrl.origin : null;
export const configuredBoardId = configuredUrl.pathname.match(/\/boards\/(\d+)/)?.[1] ?? configuredUrl.searchParams.get("rapidView");
export const localSettings = Object.freeze({ helperHost: "127.0.0.1", helperPort: 4327, browserPort: 3100, desktopPort: 3120 });
export const helperBaseUrl = `http://${localSettings.helperHost}:${localSettings.helperPort}`;
export const appProtocolVersion = 48;
export const helperProtocolVersion = 27;
