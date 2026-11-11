import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDescriptionChecklist, descriptionChecklistRows, orderChecklist, writeDescriptionChecklist, checklistPlainText } from '../lib/description-checklist.mjs';
import { toAdf, adfText, personalFields, comparableField } from '../lib/jira-fields.mjs';
import { jiraFixture } from './jira-fixture.mjs';

test('description modes preserve text and recognize saved, empty and duplicate checklist items', () => {
  const text='First line\n\nhttps://example.com\nLast line';
  assert.equal(parseDescriptionChecklist(text),null);
  const list=writeDescriptionChecklist(descriptionChecklistRows(text));
  assert.equal(checklistPlainText(list),text);
  assert.deepEqual(parseDescriptionChecklist('- [ ] Same\n- [X] Same\n- [ ]'),[{text:'Same',done:false},{text:'Same',done:true},{text:'',done:false}]);
  assert.equal(parseDescriptionChecklist('Heading\n- [ ] Item'),null);
  assert.equal(writeDescriptionChecklist(descriptionChecklistRows('')),'- [ ]');
});
test('completed checklist items sink stably and reopening them restores them to unfinished work',()=>{
 const rows=[{id:'a',text:'First',done:false},{id:'b',text:'Second',done:false},{id:'c',text:'Third',done:true}];
 const checked=orderChecklist(rows.map(row=>row.id==='a'?{...row,done:true}:row));
 assert.deepEqual(checked.map(row=>row.id),['b','a','c']);assert.deepEqual(rows.map(row=>row.id),['a','b','c']);
 assert.deepEqual(orderChecklist(checked.map(row=>row.id==='c'?{...row,done:false}:row)).map(row=>row.id),['b','c','a']);
});
test('Jira description round-trips check states, links and checked-item strikethrough with supported paragraph nodes',()=>{
 const value='- [ ] Read www.example.com\n- [x] Finished https://example.org';
 const doc=toAdf(value,{checklist:true});
 assert.equal(adfText(doc).trimEnd(),value);assert.ok(doc.content.every(node=>node.type==='paragraph'));
 assert.ok(doc.content[0].content.every(node=>!(node.marks||[]).some(mark=>mark.type==='strike')));
 assert.ok(doc.content[1].content.every(node=>node.marks.some(mark=>mark.type==='strike')));
 assert.ok(doc.content[1].content.some(node=>node.marks.some(mark=>mark.type==='link')));
 assert.equal(comparableField('description',doc),comparableField('description',value));
 assert.ok(toAdf(value).content.every(node=>node.content.every(inline=>!(inline.marks||[]).some(mark=>mark.type==='strike'))),'Comments keep normal plain-text behavior');
});
test('offline description checklist survives restart, syncs to Jira and imports subsequent Jira edits',async()=>{
 const fixture=jiraFixture(), client=await fixture.makeClient().initialise(), workspace=fixture.makeWorkspace();
 await workspace.prime(client);await workspace.synchronize(client);
 const description='- [ ] Draft\n- [x] Research';
 await workspace.update('KAN-1',{fields:{description}});
 assert.equal(adfText(workspace.viewIssue('KAN-1').fields.description).trimEnd(),description);
 const restarted=fixture.makeWorkspace();await restarted.load();assert.equal(adfText(restarted.viewIssue('KAN-1').fields.description).trimEnd(),description);
 await restarted.synchronize(client);assert.equal(restarted.queueSummary().pending,0);
 const saved=fixture.issues.get('KAN-1').fields.description;
 assert.equal(adfText(saved).trimEnd(),description);assert.deepEqual(parseDescriptionChecklist(adfText(saved).trimEnd()).map(row=>row.done),[false,true]);
 const changed='- [x] Draft\n- [x] Research';fixture.issues.get('KAN-1').fields.description=toAdf(changed,{checklist:true});
 fixture.issues.get('KAN-1').fields.updated='2026-12-01T00:00:00Z';await restarted.synchronize(client);
 assert.equal(adfText(restarted.viewIssue('KAN-1').fields.description).trimEnd(),changed);
});
test('description checklist keeps the existing Jira field-size validation',()=>{
 const field={fieldId:'description',name:'Description',required:false,schema:{type:'string'},allowedValues:[]};
 assert.throws(()=>personalFields([field],{description:'- [ ] '+ 'x'.repeat(32000)},'me'),/32,000/);
});
