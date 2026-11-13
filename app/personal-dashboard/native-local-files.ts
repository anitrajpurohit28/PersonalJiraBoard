"use client";
export type LocalFilesReply = { files?: string[]; exists?: Record<string, boolean>; opened?: boolean; error?: string };
type Host = { webkit?: { messageHandlers?: { taskFiles?: { postMessage: (body: unknown) => void } } }; chrome?: { webview?: { postMessage: (body: unknown) => void; postMessageWithAdditionalObjects?: (body: unknown, files: File[]) => void } } };
export function hasNativeFiles() { const host = window as Window & Host; return Boolean(host.webkit?.messageHandlers?.taskFiles || host.chrome?.webview); }
export function nativeFiles(action: string, values: Record<string, unknown> = {}, files?: File[]): Promise<LocalFilesReply> {
  return new Promise((resolve, reject) => {
    if (!hasNativeFiles()) { reject(new Error('Use the desktop app to choose and open local files, or paste a file path.')); return; }
    const requestId = crypto.randomUUID(), host = window as Window & Host;
    const timer = window.setTimeout(() => finish(undefined, 'The file request timed out. Please try again.'), action === 'choose' ? 300000 : 15000);
    function finish(result?: LocalFilesReply, error?: string) { window.clearTimeout(timer); window.removeEventListener('task-board-files-response', response); if (error) reject(new Error(error)); else resolve(result || {}); }
    function response(event: Event) { const reply = (event as CustomEvent).detail; if (reply?.requestId === requestId) finish(reply, reply.error); }
    window.addEventListener('task-board-files-response', response);
    const body = { type:'task-files', action, requestId, ...values };
    try {
      if (host.webkit?.messageHandlers?.taskFiles) host.webkit.messageHandlers.taskFiles.postMessage(body);
      else if (files && host.chrome?.webview?.postMessageWithAdditionalObjects) host.chrome.webview.postMessageWithAdditionalObjects(body, files);
      else if (files) throw new Error('Update Microsoft Edge WebView2 to link dropped files. You can use Add files instead.');
      else host.chrome?.webview?.postMessage(body);
    } catch (error) { finish(undefined, (error as Error).message); }
  });
}
