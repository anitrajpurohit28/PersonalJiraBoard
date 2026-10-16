import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localSettings } from "../config/settings.mjs";
import { JiraConnection } from "./jira-connection.mjs";
import { MAX_ATTACHMENT_BYTES } from "../lib/jira-fields.mjs";

async function readJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw Object.assign(new Error("JSON required."), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_ATTACHMENT_BYTES * 1.4 + 1024 * 1024) throw Object.assign(new Error("The request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("A JSON object is required."), { status: 400 });
  return value;
}

export function createJiraHelperServer(broker = new JiraConnection()) {
  return createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const origin = request.headers.origin;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host || "") || (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
      response.writeHead(403); response.end(JSON.stringify({ error: "Local app requests only." })); return;
    }
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      let result;
      if (request.method === "GET" && pathname === "/api/jira/status") result = await broker.status();
      else if (request.method === "POST" && pathname === "/api/jira/disconnect") result = broker.disconnect();
      else if (request.method === "POST" && pathname.startsWith("/api/jira/")) {
        const action = pathname.slice("/api/jira/".length);
        if (!["connect", "issues", "create-meta", "edit-meta", "create", "update", "delete", "bulk", "details", "comment-add", "comment-edit", "comment-delete", "attachment-add", "attachment-delete", "attachment-content", "link-add", "link-delete", "queue", "queue-retry", "queue-discard"].includes(action)) throw Object.assign(new Error("Not found."), { status: 404 });
        const payload = request.headers["content-length"] === "0" || (!request.headers["content-length"] && !request.headers["transfer-encoding"]) ? {} : await readJson(request);
        result = action === "connect" ? await broker.connect(payload) : await broker.command(action, payload);
      } else { response.writeHead(404); result = { error: "Not found." }; }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(error.status || 502);
      response.end(JSON.stringify({ error: error.message || "Unable to reach Jira.", ...(error.uncertain ? { uncertain: true } : {}) }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const broker = new JiraConnection();
  const server = createJiraHelperServer(broker);
  const timer = setInterval(() => { void broker.tick().catch(() => {}); }, 15000);
  timer.unref();
  server.on("error", (error) => { console.error(`Jira helper: ${error.message}`); process.exitCode = 1; });
  server.listen(localSettings.helperPort, localSettings.helperHost, () => console.log(`Direct Jira API connection ready on ${localSettings.helperPort}.`));
  function shutdown() { clearInterval(timer); broker.disconnect(); server.closeAllConnections(); server.close(() => process.exit(0)); }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
