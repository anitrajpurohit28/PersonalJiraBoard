// Split plain text without interpreting HTML or accepting executable URL schemes.
export function textLinks(value) {
  const text = String(value ?? ""), parts = [];
  const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"`]+/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    let link = match[0].replace(/[.,;:!?'’”]+$/g, "");
    // Keep balanced parentheses in URLs, but leave surrounding prose outside links.
    let previous;
    do {
      previous = link;
      for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
        if (link.endsWith(close) && link.split(close).length > link.split(open).length) link = link.slice(0, -1);
      }
      link = link.replace(/[.,;:!?'’”]+$/g, "");
    } while (link !== previous);
    try {
      const url = new URL(/^www\./i.test(link) ? `https://${link}` : link);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) continue;
      if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
      parts.push({ text: link, href: url.href });
      offset = match.index + link.length;
    } catch { /* Leave incomplete or invalid URLs as plain text. */ }
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
