import assert from "node:assert/strict";
import test from "node:test";
import { textLinks } from "../lib/text-links.mjs";
import { adfText, toAdf, inheritedPriority, personalFields } from "../lib/jira-fields.mjs";

test("pasted links preserve surrounding text, newlines, query strings and balanced URL parentheses", () => {
  const text = "Read (https://example.com/wiki/Thing_(one)?a=1&b=2).\nThen www.example.org/path, https://other.example/#section!";
  const parts = textLinks(text);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(parts.filter((part) => part.href).map((part) => part.href), ["https://example.com/wiki/Thing_(one)?a=1&b=2", "https://www.example.org/path", "https://other.example/#section"]);
  assert.equal(textLinks("No links\nplain text")[0].text, "No links\nplain text");
});

test("executable URL schemes and HTML are never interpreted as links or markup", () => {
  const parts = textLinks('<script>alert(1)</script> javascript:alert(1) data:text/html,hello https:// <img src=x>');
  assert.equal(parts.filter((part) => part.href).length, 0);
  assert.equal(parts.map((part) => part.text).join(""), '<script>alert(1)</script> javascript:alert(1) data:text/html,hello https:// <img src=x>');
});

test("descriptions and comments send clickable Jira ADF link marks without changing text", () => {
  const text = "Notes https://example.com/a?q=one&b=two.\n\nMore at www.example.org";
  const adf = toAdf(text);
  assert.equal(adfText(adf).trimEnd(), text);
  const links = adf.content.flatMap((paragraph) => paragraph.content).filter((node) => node.marks);
  assert.deepEqual(links.map((node) => node.marks), [[{ type: "link", attrs: { href: "https://example.com/a?q=one&b=two" } }], [{ type: "link", attrs: { href: "https://www.example.org/" } }]]);
  assert.deepEqual(toAdf(""), { type: "doc", version: 1, content: [{ type: "paragraph", content: [] }] });
});

test("parent priority resolves site-specific IDs and names, while explicit priority wins", () => {
  const priorities = [{ id: "low-id", name: "Low" }, { id: "normal-id", name: "Medium" }, { id: "high-id", name: "High" }];
  const metadata = [{ fieldId: "summary", name: "Summary", required: true, schema: { type: "string" } }, { fieldId: "priority", name: "Priority", hasDefaultValue: true, schema: { type: "priority" }, allowedValues: priorities }];
  for (const priority of priorities) {
    assert.equal(inheritedPriority(priorities, priority), priority.id);
    assert.equal(inheritedPriority(priorities, { id: "old-site-id", name: priority.name }), priority.id);
    assert.equal(personalFields(metadata, { summary: "Child" }, "me", { creating: true, parentPriority: priority }).fields.priority.id, priority.id);
  }
  assert.equal(personalFields(metadata, { summary: "Child", priority: "low-id" }, "me", { creating: true, parentPriority: priorities[2] }).fields.priority.id, "low-id");
  assert.equal(personalFields(metadata, { summary: "Root" }, "me", { creating: true }).fields.priority.id, "normal-id");
  assert.equal(inheritedPriority(priorities, { id: "unavailable", name: "Unknown" }), undefined);
});
