import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Set the environment in Node so the same command works in Windows and Unix shells.
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url)), "build"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit",
  env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log" },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
