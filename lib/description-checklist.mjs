// Keep check states in the description itself, so offline sync and Jira recovery retain them.
const itemPattern = /^\s*[-*]\s+\[([ xX])\](?: (.*))?$/;
export function readChecklistLine(line) {
  const match = itemPattern.exec(line);
  return match ? { text: match[2] || '', done: match[1].toLowerCase() === 'x' } : null;
}
export function parseDescriptionChecklist(value) {
  if (!value) return null;
  const rows = String(value).replace(/\r\n?/g, '\n').split('\n').map(readChecklistLine);
  return rows.every(Boolean) ? rows : null;
}
export function descriptionChecklistRows(value) {
  return (value ? String(value).replace(/\r\n?/g, '\n').split('\n') : ['']).map(line => readChecklistLine(line) || { text: line, done: false });
}
export function orderChecklist(rows) {
  return [...rows].sort((a, b) => Number(a.done) - Number(b.done));
}
export function writeDescriptionChecklist(rows) {
  return orderChecklist(rows).map(row => `- [${row.done ? 'x' : ' '}]${row.text ? ` ${row.text}` : ''}`).join('\n');
}
export function checklistPlainText(value) {
  return (parseDescriptionChecklist(value) || []).map(row => row.text).join('\n');
}
