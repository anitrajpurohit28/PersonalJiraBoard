import { readFile, writeFile, mkdir, rename, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storageNamespace } from "../config/settings.mjs";
import { jiraError } from "../lib/jira-fields.mjs";

const root = process.platform === "darwin" ? path.join(homedir(), "Library", "Application Support") : process.platform === "win32" ? process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local") : process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
export const privateDirectory = process.env.PERSONAL_TASK_BOARD_PRIVATE_DIR || path.join(root, "PersonalTaskBoard", "private", storageNamespace);
const suppliedFile = fileURLToPath(new URL("../config/credentials.json", import.meta.url));
const savedFile = path.join(privateDirectory, "credentials.json");

export function validateApiToken(value) {
  if (typeof value !== "string" || !value.trim() || /[\s\r\n]/.test(value.trim()) || value.length > 10000) throw jiraError("Enter a valid Jira API token.");
  return value.trim();
}
async function readToken(file) {
  let text;
  try { text = await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw jiraError("The private Jira credentials file must contain valid JSON."); }
  if (!parsed?.apiToken) return null;
  return validateApiToken(parsed.apiToken);
}
export async function loadApiToken() {
  if (process.env.JIRA_API_TOKEN) return { token: validateApiToken(process.env.JIRA_API_TOKEN), source: "environment" };
  const supplied = await readToken(suppliedFile);
  if (supplied) return { token: supplied, source: "config/credentials.json" };
  const saved = await readToken(savedFile);
  return saved ? { token: saved, source: "saved on this device" } : null;
}
export async function saveApiToken(token) {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${savedFile}.tmp`;
  await writeFile(temporary, JSON.stringify({ apiToken: validateApiToken(token) }, null, 2), { mode: 0o600 });
  await rename(temporary, savedFile);
}

export async function readCreateReceipt(requestId) {
  try { return JSON.parse(await readFile(path.join(privateDirectory, `create-${requestId}.json`), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function writeCreateReceipt(requestId, value) {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(privateDirectory, `create-${requestId}.json`);
  const temporary = `${destination}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, destination);
}
