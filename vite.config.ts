import { storageNamespace } from "./config/settings.mjs";
import vinext from "vinext";
import { defineConfig } from "vite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const dataRoot = process.platform === "darwin"
  ? join(homedir(), "Library", "Application Support", "PersonalTaskBoard", "data")
  : process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "PersonalTaskBoard", "data")
    : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "PersonalTaskBoard", "data");
const dataDirectory = process.env.PERSONAL_TASK_BOARD_DATA_DIR ?? join(dataRoot, storageNamespace);

export default defineConfig(async ({ command }) => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const nodeDatabase = process.platform === "win32" || process.env.PJB_NODE_DATABASE === "1";
  process.env.PERSONAL_TASK_BOARD_NODE_DATA_DIR = dataDirectory;
  const cloudflarePlugin = nodeDatabase ? [] : [(await import("@cloudflare/vite-plugin")).cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: { main: "./worker/index.ts", compatibility_flags: ["nodejs_compat"],
        ...(process.env.PERSONAL_TASK_BOARD_HELPER_PORT ? { vars: { PERSONAL_TASK_BOARD_HELPER_PORT: process.env.PERSONAL_TASK_BOARD_HELPER_PORT } } : {}),
        d1_databases: [{ binding: "DB", database_name: "personal-tasks", database_id: "00000000-0000-4000-8000-000000000000" }],
      }, persistState: command === "serve" ? { path: dataDirectory } : false,
  })];
  return {
    resolve: { alias: { "@": resolve("."), "@lib": resolve("lib"), ...(nodeDatabase ? { "cloudflare:workers": resolve("local/node-env.mjs") } : {}) } },
    server: {
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/config/credentials.json", "**/private/**"] },
      ...(process.env.CODEX_SANDBOX === "seatbelt" ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [vinext(), ...cloudflarePlugin],
  };
});
