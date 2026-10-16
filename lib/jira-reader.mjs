// Transport-independent Jira reads, shared by the direct API client and tests.
export const ISSUE_FIELDS = "summary,description,status,priority,assignee,reporter,created,updated,project,issuetype,parent,duedate,labels,subtasks,attachment,issuelinks";

export function verifyIdentity(identity, expectedEmail) {
  const email = String(identity?.emailAddress ?? "").trim().toLowerCase();
  if (!identity?.accountId || !email || email !== expectedEmail.toLowerCase()) {
    throw new Error(`Sign in as ${expectedEmail}. This app only accepts that account.`);
  }
  return { accountId: identity.accountId, emailAddress: email, displayName: String(identity.displayName || email) };
}

export function personalJql() {
  return "(assignee = currentUser() OR reporter = currentUser()) ORDER BY updated DESC";
}

export async function readJiraIssues(request, { boardId = null, accountId, keys = null }) {
  if (!accountId) throw new Error("A verified Jira account is required.");
  if (boardId !== null && !/^[1-9]\d*$/.test(String(boardId))) throw new Error("Invalid Jira board ID.");
  if (keys && (!keys.length || keys.some((key) => !/^[A-Z][A-Z0-9_]*-\d+$/.test(key)))) throw new Error("Invalid Jira issue key.");
  const issues = new Map();
  const seenTokens = new Set();
  let nextPageToken;
  let legacy = false;
  let startAt = 0;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ fields: ISSUE_FIELDS, maxResults: "100" });
    if (keys) params.set("jql", `key in (${keys.map((key) => `"${key}"`).join(",")})${boardId ? "" : " AND (assignee = currentUser() OR reporter = currentUser())"}`);
    else if (!boardId) params.set("jql", personalJql());
    if (legacy) params.set("startAt", String(startAt));
    else if (nextPageToken) params.set("nextPageToken", nextPageToken);
    const pathname = boardId
      ? `/rest/${legacy ? "agile" : "software"}/1.0/board/${boardId}/issue`
      : "/rest/api/3/search/jql";
    let payload;
    try { payload = await request(`${pathname}?${params}`); }
    catch (error) {
      // Some Jira sites have not enabled the newer board API yet.
      if (boardId && !legacy && page === 0 && [404, 410].includes(error.status)) { legacy = true; page--; continue; }
      throw error;
    }
    if (!Array.isArray(payload?.issues)) throw new Error("Jira returned an incomplete result. Nothing was imported.");
    for (const issue of payload.issues) {
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issue?.key) || typeof issue.fields?.summary !== "string") throw new Error("Jira returned an invalid issue. Nothing was imported.");
      // A board URL means all visible board entries, including unassigned tasks.
      // A site-only URL keeps the personal assignee/reporter restriction.
      if (boardId || issue.fields.assignee?.accountId === accountId || issue.fields.reporter?.accountId === accountId) issues.set(issue.key, issue);
    }
    if (legacy) {
      startAt += payload.issues.length;
      if (payload.isLast === true || (Number.isFinite(payload.total) && startAt >= payload.total)) return [...issues.values()];
      if (!payload.issues.length || !Number.isFinite(payload.total)) break;
    } else {
      if (payload.isLast === true) return [...issues.values()];
      nextPageToken = payload.nextPageToken;
      if (!nextPageToken || seenTokens.has(nextPageToken)) break;
      seenTokens.add(nextPageToken);
    }
  }
  throw new Error("Jira pagination was incomplete. Nothing was imported; try syncing again.");
}

export async function readJiraSnapshot(request, { email, boardId = null }) {
  const identity = verifyIdentity(await request("/rest/api/3/myself"), email);
  let board = null;
  if (boardId) {
    board = await request(`/rest/agile/1.0/board/${boardId}`);
    if (String(board?.id) !== String(boardId) || !board?.name) throw new Error("Jira did not return the configured board.");
  }
  const issues = await readJiraIssues(request, { accountId: identity.accountId, boardId });
  const statuses = new Map();
  const priorities = new Map();
  for (const { fields } of issues) {
    if (fields.status?.name) statuses.set(fields.status.name, { id: fields.status.id, name: fields.status.name, category: fields.status.statusCategory?.key });
    if (fields.priority?.name) priorities.set(fields.priority.name, { id: fields.priority.id, name: fields.priority.name });
  }
  return { identity, boardId, issues, metadata: { boardName: board?.name ?? null, statuses: [...statuses.values()], priorities: [...priorities.values()] } };
}
