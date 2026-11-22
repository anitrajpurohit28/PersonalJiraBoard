import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

if (process.platform !== "win32") throw new Error("This launcher runs on Windows. On macOS use npm run desktop.");
const flags = process.argv.slice(2);
const runtime = flags[0]?.startsWith('win-') ? flags.shift() : `win-${process.arch}`;
if (!["win-x64", "win-arm64"].includes(runtime)) throw new Error("Use win-x64 or win-arm64.");
if (flags.some(flag => flag !== "--setup")) throw new Error("Use --setup to change the saved Jira account.");
const executable = fileURLToPath(new URL(`../../outputs/windows/${runtime}/PersonalTaskBoard.exe`, import.meta.url));
await access(executable).catch(() => { throw new Error("Build the Windows app first with npm run windows:build."); });
console.log(`Launching ${executable}`);
const child = spawn(executable, flags, { cwd: path.dirname(executable), detached: true, stdio: "ignore", windowsHide: false });
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.unref();
