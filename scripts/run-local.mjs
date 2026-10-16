import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configurationId, helperBaseUrl, helperProtocolVersion, localSettings } from "../config/settings.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || localSettings.browserPort);
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
function start(file, args = []) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], {
    cwd: project, stdio: "inherit", env: { ...process.env, PORT: String(port), WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
  });
  children.add(child);
  child.once("error", (error) => { console.error(error.message); stop(1); });
  child.once("exit", (code) => { children.delete(child); if (!stopping) stop(code ?? 1); });
  return child;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

try {
  if (production) {
    // Build with the two settings supplied before startup, then run the worker runtime.
    const builder = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url)), "build"], { cwd: project, stdio: "inherit", env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" } });
    children.add(builder);
    const result = await new Promise((resolve, reject) => { builder.once("error", reject); builder.once("exit", resolve); });
    children.delete(builder);
    if (result !== 0) throw new Error("Build failed.");
    if (stopping) process.exit(0);
  }
  const existing = await fetch(`${helperBaseUrl}/api/jira/status`, { signal: AbortSignal.timeout(1000) }).then((response) => response.json()).catch(() => null);
  if (existing && (existing.configId !== configurationId || existing.protocolVersion !== helperProtocolVersion)) throw new Error("An older or different Jira service is running. Close the other task-board app before starting this one.");
  if (!existing) start("../local/jira-server.mjs");
  if (production) start("../node_modules/vite/bin/vite.js", ["preview", "--port", String(port), "--strictPort"]);
  else start("../node_modules/vinext/dist/cli.js", ["dev", "--port", String(port)]);
  console.log(`My tasks: http://localhost:${port}`);
} catch (error) { console.error(error.message); stop(1); }
