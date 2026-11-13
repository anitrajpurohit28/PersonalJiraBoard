// Ignore blank paragraphs and old empty checkboxes; retain duplicate nonempty tasks.
const itemPattern = /^\s*(?:[-*]\s+)?\[([ xX])\](?:\s+(.*))?\s*$/;
export function readChecklistLine(line) {
  const match = itemPattern.exec(line);
  return match ? { text: (match[2] || '').trimEnd(), done: match[1].toLowerCase() === 'x' } : null;
}
export function parseDescriptionChecklist(value) {
  const lines = String(value || '').replace(/\r\n?/g,'\n').split('\n').filter(line => line.trim());
  if (!lines.length) return null;
  const rows = lines.map(readChecklistLine);
  return rows.every(Boolean) ? rows.filter(row => row.text.trim()) : null;
}
export function descriptionChecklistRows(value) {
  return String(value || '').replace(/\r\n?/g,'\n').split('\n').map(line => readChecklistLine(line) || {text:line.trimEnd(),done:false}).filter(row => row.text.trim());
}
export function orderChecklist(rows) { return [...rows].sort((a,b) => Number(a.done)-Number(b.done)); }
export function writeDescriptionChecklist(rows) {
  return orderChecklist(rows).filter(row => row.text.trim()).map(row => `- [${row.done ? 'x' : ' '}] ${row.text}`).join('\n');
}
export function checklistPlainText(value) { return String(value || '').replace(/\r\n?/g,'\n').split('\n').map(line => { const match=itemPattern.exec(line);return match ? match[2] || '' : line; }).join('\n'); }
