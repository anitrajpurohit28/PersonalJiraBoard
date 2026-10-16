export function assertLocalMutation(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || (origin && origin !== url.origin)) {
    throw Object.assign(new Error("Changes must come from the local dashboard."), { status: 403 });
  }
}
export function errorResponse(error: unknown, fallback: string) {
  const detail = error as { message?: string; status?: number; uncertain?: boolean };
  return Response.json({ error: detail?.message || fallback, ...(detail?.uncertain ? { uncertain: true } : {}) }, { status: detail?.status && detail.status >= 400 && detail.status < 600 ? detail.status : 500 });
}
