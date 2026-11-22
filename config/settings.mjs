import rawSettings from "./app.json" with { type: "json" };

import { validateSettings, configurationFor } from "../lib/app-config.mjs";
export { validateSettings };
export const settings = validateSettings(rawSettings);
export const { configurationId, storageNamespace } = configurationFor(settings);
export const configuredUrl = new URL(settings.jiraUrl);
export const configuredCloudId = configuredUrl.searchParams.get("cloudId");
export const configuredSite = configuredUrl.hostname.endsWith(".atlassian.net") ? configuredUrl.origin : null;
export const configuredBoardId = configuredUrl.pathname.match(/\/boards\/(\d+)/)?.[1] ?? configuredUrl.searchParams.get("rapidView");
export { localSettings, helperBaseUrl, appProtocolVersion, helperProtocolVersion } from "./local-settings.mjs";
