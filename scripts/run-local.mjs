import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localSettings } from "../config/local-settings.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || localSettings.browserPort);
const logsDirectory = path.join(project, "logs");
const logFile = path.join(logsDirectory, "browser.log");
const children = new Set();
let logging = true;

function logTo(stream, chunk) {
  stream.write(chunk);
  if (!logging) return;
  try { appendFileSync(logFile, chunk, { mode: 0o600 }); }
  catch (error) {
    logging = false;
    process.stderr.write(`Could not write browser diagnostics to ${logFile}: ${error.message}\n`);
  }
}

function launch(file, args = []) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], {
    cwd: project,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), WRANGLER_LOG_PATH: path.join(logsDirectory, "browser-wrangler.log") },
  });
  children.add(child);
  child.stdout.on("data", (chunk) => logTo(process.stdout, chunk));
  child.stderr.on("data", (chunk) => logTo(process.stderr, chunk));
  child.once("close", () => children.delete(child));
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
function start(file, args = []) {
  const child = launch(file, args);
  child.once("error", (error) => { logTo(process.stderr, `${error.message}\n`); stop(1); });
  child.once("close", (code) => { if (!stopping) stop(code ?? 1); });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

try { mkdirSync(logsDirectory, { recursive: true, mode: 0o700 }); }
catch { /* Keep running with terminal output if file logging is unavailable. */ }
logTo(process.stdout, `[${new Date().toISOString()}] Starting browser dashboard.\n`);

try {
  const { configurationId, helperBaseUrl, helperProtocolVersion } = await import("../config/settings.mjs");
  if (production) {
    // Build with the two settings supplied before startup, then run the worker runtime.
    const builder = launch("../node_modules/vinext/dist/cli.js", ["build"]);
    const result = await new Promise((resolve, reject) => { builder.once("error", reject); builder.once("close", resolve); });
    if (result !== 0) throw new Error("Build failed.");
    if (stopping) process.exit(0);
  }
  const existing = await fetch(`${helperBaseUrl}/api/jira/status`, { signal: AbortSignal.timeout(1000) }).then((response) => response.json()).catch(() => null);
  if (existing && (existing.configId !== configurationId || existing.protocolVersion !== helperProtocolVersion)) throw new Error("An older or different Jira service is running. Close the other task-board app before starting this one.");
  if (!existing) start("../local/jira-server.mjs");
  if (production) start("../node_modules/vite/bin/vite.js", ["preview", "--port", String(port), "--strictPort"]);
  else start("../node_modules/vinext/dist/cli.js", ["dev", "--port", String(port)]);
  logTo(process.stdout, `My tasks: http://localhost:${port}\n`);
} catch (error) { logTo(process.stderr, `${error.message}\n`); stop(1); }
