import { access, cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadApiToken, saveApiToken } from "../local/jira-credentials.mjs";

if (process.platform !== "darwin") throw new Error("This installer requires macOS. Use npm run windows:build on Windows.");
const source = fileURLToPath(new URL("../outputs/Personal Jira Board.app", import.meta.url));
const destination = "/Applications/Personal Jira Board.app";
await stat(path.join(source, "Contents/MacOS/PersonalJiraBoard")).catch(() => { throw new Error("Run npm run desktop:build first."); });

let exists = false;
try { await stat(destination); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
if (exists) {
  const identifier = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", `${destination}/Contents/Info.plist`], { encoding: "utf8" }).trim();
  if (identifier !== "com.anit.personaljiraboard") throw new Error("Another app occupies the installation path. Move it before installing.");
}

// A standard macOS account can update an app it owns even when it cannot
// create a sibling in /Applications. Stage and swap Contents inside that app.
const updateContents = exists && !await access(path.dirname(destination), constants.W_OK).then(() => true, () => false);
const staging = updateContents ? path.join(destination, `.update-${process.pid}.app`) : `/Applications/.Personal Jira Board-${process.pid}.app`;
const installed = updateContents ? path.join(destination, "Contents") : destination;
const replacement = updateContents ? path.join(staging, "Contents") : staging;
const backup = updateContents ? path.join(destination, `.previous-${process.pid}`) : `${staging}.previous`;

try {
  await mkdir("/Applications", { recursive: true });
  await cp(source, staging, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", staging]);
  // Keep the private token on this Mac, never inside a distributable .app.
  const credential = await loadApiToken();
  if (credential) await saveApiToken(credential.token);
  if (exists) await rename(installed, backup);
  try { await rename(replacement, installed); }
  catch (error) { if (exists) await rename(backup, installed); throw error; }
  if (exists) await rm(backup, { recursive: true });
} finally { await rm(staging, { recursive: true, force: true }); }
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", destination]);

const info = JSON.parse(await readFile(`${destination}/Contents/Resources/Runtime.json`, "utf8"));
console.log(`Installed ${destination}\nJira board configuration: ${info.configurationId}\nOpen Personal Jira Board from Applications or Spotlight.`);
