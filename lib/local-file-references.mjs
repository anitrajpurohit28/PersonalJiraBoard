// File references are ordinary file URLs in the Jira description. No file bytes are uploaded.
export function localFileUrl(value) {
  let raw = String(value || '').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1,-1);
  if (!raw || /[\x00-\x1f]/.test(raw)) throw new Error('Enter an absolute file path or file:// URL.');
  if (/^[a-z]:[\\/]/i.test(raw)) raw = 'file:///' + raw.replace(/\\/g,'/').split('/').map((part,index) => index ? encodeURIComponent(part) : part).join('/');
  else if (raw.startsWith('/') && !raw.startsWith('//')) raw = 'file://' + raw.split('/').map(encodeURIComponent).join('/');
  const url = new URL(raw);
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.username || url.password || url.port || url.search || url.hash || /%00|%2f|%5c/i.test(url.pathname)) throw new Error('Use a local file path on this computer. Network paths are not supported.');
  url.hostname = '';
  const decoded = decodeURIComponent(url.pathname);
  if (!decoded.startsWith('/') || /[\x00-\x1f]/.test(decoded) || (/^\/[a-z]:/i.test(decoded) && (!/^\/[a-z]:\//i.test(decoded) || decoded.slice(3).includes(':')))) throw new Error('Choose a file, using its full local path.');
  return url.href;
}
export function fileReferenceName(value) {
  try { return decodeURIComponent(new URL(localFileUrl(value)).pathname.replace(/\/+$/,'').split('/').at(-1)) || '/'; } catch { return 'Local file'; }
}
export function standaloneFileReference(line) {
  const value = String(line).trim();
  if (!/^file:\/\//i.test(value)) return null;
  try { return localFileUrl(value); } catch { return null; }
}
export function descriptionParts(value) {
  const raw = String(value || '').replace(/\r\n?/g,'\n'), lines = raw.split('\n');
  const files = [...new Set(lines.map(standaloneFileReference).filter(url => typeof url === "string"))];
  if (!files.length) return { body: raw, files };
  let tail = lines.length;
  while (tail > 0 && standaloneFileReference(lines[tail-1])) tail--;
  if (tail < lines.length) {
    // Remove only the file block's separator, never the user's trailing spaces or newlines.
    let body = lines.slice(0,tail).filter(line=>!standaloneFileReference(line)).join('\n');
    if (body.endsWith('\n')) body = body.slice(0,-1);
    return { body, files };
  }
  return { body: lines.filter(line=>!standaloneFileReference(line)).join('\n'), files };
}
export function descriptionWithFiles(body, files) {
  const text = String(body || ''), normalized = [...new Set(files.map(localFileUrl))];
  if (!normalized.length) return text;
  return text ? `${text}\n\n${normalized.join('\n')}` : normalized.join('\n');
}
export function addDescriptionFiles(value, files) {
  const parts = descriptionParts(value);
  return descriptionWithFiles(parts.body, [...parts.files, ...files]);
}

export function localFileTextParts(value) {
  const text=String(value || ''),parts=[];let offset=0;
  for(const match of text.matchAll(/\bfile:\/\/[^\s<>"`]+/gi)) {
    let url;try{url=localFileUrl(match[0]);}catch{continue;}
    if(match.index>offset)parts.push({text:text.slice(offset,match.index)});
    parts.push({text:match[0],fileUrl:url});offset=match.index+match[0].length;
  }
  if(offset<text.length)parts.push({text:text.slice(offset)});return parts;
}
