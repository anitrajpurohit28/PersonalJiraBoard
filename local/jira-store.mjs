import { readFile, open, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { privateDirectory } from "./jira-credentials.mjs";

export function workspaceStore(directory = privateDirectory) {
  const stateFile = path.join(directory, "workspace-v1.json");
  function blobPath(key) {
    if (!/^(file-[a-f0-9-]{36}|attachment-\d+)$/.test(key)) throw new Error("Invalid cached file.");
    return path.join(directory, "attachments", key);
  }
  async function atomicWrite(file, data) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  }
  return {
    async readState() {
      try { return JSON.parse(await readFile(stateFile, "utf8")); }
      catch (error) { if (error.code === "ENOENT") return null; throw new Error("The offline workspace could not be read. Your saved changes have been kept; check the app log."); }
    },
    writeState: (state) => atomicWrite(stateFile, JSON.stringify(state)),
    writeBlob: (key, data) => atomicWrite(blobPath(key), data),
    async readBlob(key) { try { return await readFile(blobPath(key)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
    deleteBlob: (key) => rm(blobPath(key), { force: true }),
  };
}
