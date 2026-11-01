import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("This launcher runs on Windows. On macOS use npm run desktop.");
const runtime = process.argv[2] || `win-${process.arch}`;
if (!["win-x64", "win-arm64"].includes(runtime)) throw new Error("Use win-x64 or win-arm64.");
const executable = fileURLToPath(new URL(`../../outputs/windows/${runtime}/PersonalTaskBoard.exe`, import.meta.url));
await access(executable).catch(() => { throw new Error("Build the Windows app first: npm run windows:build"); });
const child = spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: false });
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.unref();
