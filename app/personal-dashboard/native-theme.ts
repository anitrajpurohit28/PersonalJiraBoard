// Keep browser favicons and the running desktop icon aligned with the app theme.
export function syncThemeIcon(theme: "light" | "dark") {
  if (typeof window === "undefined" || !["light", "dark"].includes(theme)) return;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.setAttribute("href", theme === "dark" ? "/favicon-dark.png" : "/favicon.png");
  const host = window as Window & {
    webkit?: { messageHandlers?: { taskTheme?: { postMessage(theme: string): void } } };
    chrome?: { webview?: { postMessage(body: unknown): void } };
  };
  // An older desktop host must never prevent switching the dashboard theme.
  try {
    if (host.webkit?.messageHandlers?.taskTheme) host.webkit.messageHandlers.taskTheme.postMessage(theme);
    else host.chrome?.webview?.postMessage({ type: "task-theme", theme });
  } catch {}
}
