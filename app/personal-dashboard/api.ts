export async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || "The change could not be saved."), { status: response.status, uncertain: payload.uncertain });
  return payload;
}
