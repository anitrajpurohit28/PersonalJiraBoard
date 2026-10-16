import { env } from "cloudflare:workers";

export function getD1() {
  if (!env.DB) throw new Error("The local task database is unavailable. Restart the app.");
  return env.DB;
}
