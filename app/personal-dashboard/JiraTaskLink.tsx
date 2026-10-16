"use client";

export function JiraTaskLink({ jiraKey, onOpen, disabled = false }: { jiraKey: string; onOpen?: () => void; disabled?: boolean }) {
  const label = jiraKey.startsWith("local:") ? "Pending task" : jiraKey;
  return onOpen ? <button type="button" className="jira-task-link" title={`Open ${label} in this app`} disabled={disabled} onClick={onOpen}>{label}</button> : <span className="jira-task-key">{label}</span>;
}

export function WebJiraLink({ jiraKey, href }: { jiraKey: string; href?: string }) {
  return href ? <a className="web-jira-link" href={href} target="_blank" rel="noreferrer" aria-label={`WebJira: ${jiraKey}`} title={`Open ${jiraKey} in Jira on the web`}>WebJira ↗</a> : null;
}
