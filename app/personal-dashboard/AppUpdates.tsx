"use client";
import { useEffect, useState } from "react";
import { TaskModal } from "./TaskModal";
import { requestJson } from "./api";

type UpdateStatus = { currentVersion: string; development: boolean; canInstall: boolean; candidate: { version: string } | null; releasePage: string; message?: string; jobId?: string; readyVersion?: string; lastUpdate?: { ok: boolean; error?: string } };
type NativeUpdates = { webkit?: { messageHandlers?: { taskUpdates?: { postMessage: (id: string) => void } } }; chrome?: { webview?: { postMessage: (value: unknown) => void } } };
export function AppUpdates() {
  const [open, setOpen] = useState(false), [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    const failed = (event: Event) => { setBusy(false); setPhase(""); setError(String((event as CustomEvent).detail || "The installer could not start. Try again.")); };
    window.addEventListener("personal-jira-update-error", failed);
    return () => window.removeEventListener("personal-jira-update-error", failed);
  }, []);
  async function action(action: "check" | "prepare") {
    setBusy(true); setError(""); setPhase(action === "check" ? "Checking for updates…" : "Downloading and verifying the update… This can take a few minutes.");
    try { setStatus(await requestJson("/api/app-updates", { method: "POST", body: JSON.stringify({ action, version: status?.candidate?.version }) })); }
    catch (error) { setError(error instanceof Error ? error.message : "Updates are unavailable. You can continue working."); }
    finally { setBusy(false); setPhase(""); }
  }
  function install() {
    if (!status?.jobId) return;
    const host = window as Window & NativeUpdates;
    setError(""); setBusy(true); setPhase("Restarting to install… Your local work will be backed up.");
    try {
      if (host.webkit?.messageHandlers?.taskUpdates) host.webkit.messageHandlers.taskUpdates.postMessage(status.jobId);
      else if (host.chrome?.webview) host.chrome.webview.postMessage({ type: "app-update-install", jobId: status.jobId });
      else throw new Error("Open the installed desktop app to install this update.");
    } catch (error) { setError((error as Error).message); setBusy(false); setPhase(""); }
  }
  return <>
    <button type="button" className="layout-toggle" onClick={() => { setOpen(true); void action("check"); }}>Update</button>
    {open ? <TaskModal title="Application updates" busy={busy} onClose={() => setOpen(false)}>
      <div className="app-updates" aria-live="polite">
        {status ? <p>Version {status.currentVersion}{status.development ? " · Local build" : ""}</p> : null}
        {phase ? <p role="status">{phase}</p> : null}
        {error ? <p role="alert" className="notice error">{error}</p> : status?.lastUpdate?.ok === false ? <p role="alert" className="notice error">The previous update did not finish: {status.lastUpdate.error}</p> : null}
        {!busy && status ? <>
          {status.jobId ? <><p>Version {status.readyVersion} is ready. The app will close and reopen. Your Jira connection, tasks, and offline changes will be preserved.</p><button className="primary" onClick={install}>Restart &amp; update</button></>
          : status.candidate ? <><p>Version {status.candidate.version} is available.</p>{status.canInstall ? <button className="primary" onClick={() => void action("prepare")}>Download update</button> : <p>Install updates from the desktop app. <a href={status.releasePage} target="_blank" rel="noreferrer">Download desktop releases</a></p>}</>
          : <p>{status.message || "You are up to date."}</p>}
        </> : null}
        {!busy && !status?.jobId ? <button onClick={() => void action("check")}>Check again</button> : null}
      </div>
    </TaskModal> : null}
  </>;
}
