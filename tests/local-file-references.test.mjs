import test from 'node:test';
import assert from 'node:assert/strict';
import { localFileUrl, fileReferenceName, descriptionParts, descriptionWithFiles, addDescriptionFiles, localFileTextParts } from '../lib/local-file-references.mjs';
import { adfText, toAdf, descriptionText, comparableField } from '../lib/jira-fields.mjs';
import { jiraFixture } from './jira-fixture.mjs';
test('file paths normalize across macOS and Windows without losing spaces, unicode or punctuation',()=>{
 for(const [input,expected] of [['/Users/example/Downloads/Jira icon (1).png','file:///Users/example/Downloads/Jira%20icon%20(1).png'],['C:\\Users\\Example\\My files\\report #2.pdf','file:///C:/Users/Example/My%20files/report%20%232.pdf'],['"C:\\Users\\Example\\report.pdf"','file:///C:/Users/Example/report.pdf'],['file://localhost/Users/me/file.txt','file:///Users/me/file.txt']])assert.equal(localFileUrl(input),expected);
 assert.equal(fileReferenceName('file:///Users/me/%E6%97%A5%E6%9C%AC%20(1).pdf'),'日本 (1).pdf');
});
test('file references reject remote hosts, other protocols, relative paths and NTFS alternate streams',()=>{
 for(const input of ['https://example.org/file','javascript:alert(1)','../file.pdf','file://server/share/secret','file:///C:/file.txt:execute','file:///tmp/file%00.txt','file:///tmp/a%2fb.txt','file:///tmp/a%5cb.txt','file:///tmp/file?x=1','file:///tmp/file#part'])assert.throws(()=>localFileUrl(input),input);
});
test('references remain separate from checklist rows, deduplicate, and remove without changing the description body',()=>{
 const body='- [ ] Draft\n- [x] Research',one='file:///Users/me/report.pdf',two='file:///C:/Users/me/report.pdf';
 const saved=addDescriptionFiles(body,[one,one,two]);assert.deepEqual(descriptionParts(saved),{body,files:[one,two]});
 assert.equal(descriptionWithFiles(descriptionParts(saved).body,[]),body);
 assert.equal(adfText(toAdf(saved,{checklist:true})).trimEnd(),saved);
 assert.ok(toAdf(saved,{checklist:true}).content[1].content.every(node=>node.marks.some(mark=>mark.type==='strike')));
 assert.deepEqual(localFileTextParts('Review '+one+' then https://example.org').filter(part=>part.fileUrl).map(part=>part.fileUrl),[one]);
});
test('local file references survive offline restart and Jira sync without uploading file bytes',async()=>{
 const fixture=jiraFixture(),client=await fixture.makeClient().initialise(),workspace=fixture.makeWorkspace();await workspace.prime(client);await workspace.synchronize(client);
 const value=addDescriptionFiles('- [ ] Read the report',['file:///Users/me/report.pdf']);await workspace.update('KAN-1',{fields:{description:value}});
 const restarted=fixture.makeWorkspace();await restarted.load();await restarted.synchronize(client);
 assert.equal(adfText(fixture.issues.get('KAN-1').fields.description).trimEnd(),value);
 assert.equal(fixture.files.size,0);assert.equal(restarted.queueSummary().pending,0);
});

test('typing and file serialization preserve spaces, tabs and every trailing newline',()=>{
 const files=['file:///Users/example/Screenshot%2014:25.png','file:///Users/example/Second%20file.pdf'];
 for(const body of ['', ' ', '\n', 'First ', 'First\n', 'First \n\nSecond\t \n\n']){
  assert.deepEqual(descriptionParts(body),{body,files:[]});assert.equal(descriptionWithFiles(body,[]),body);
  assert.deepEqual(descriptionParts(descriptionWithFiles(body,files)),{body,files});
  assert.equal(descriptionText(toAdf(body,{checklist:true})),body);
 }
 assert.equal(localFileUrl('/Users/example/Screenshot 14:25.png'),'file:///Users/example/Screenshot%2014%3A25.png');
 assert.notEqual(comparableField('description','First'),comparableField('description','First '));
 assert.notEqual(comparableField('description','First'),comparableField('description','First\n'));
});
test('whitespace-only changes survive queued offline edits and Jira acknowledgements',async()=>{
 const fixture=jiraFixture(),client=await fixture.makeClient().initialise(),workspace=fixture.makeWorkspace();await workspace.prime(client);await workspace.synchronize(client);
 for(const value of ['First','First ','First \n','First \n\nSecond\n']){
  await workspace.update('KAN-1',{fields:{description:value}});await workspace.synchronize(client);
  assert.equal(descriptionText(fixture.issues.get('KAN-1').fields.description),value);
  assert.equal(workspace.queueSummary().pending,0);
 }
});

test('folder and app bundle references retain their paths and display names',()=>{
 for(const value of ['file:///Users/example/Documents/','file:///Applications/Example.app/','file:///C:/Users/Example/Documents/','file:///'])assert.equal(localFileUrl(value),value);
 assert.equal(fileReferenceName('file:///Users/example/My%20folder/'),'My folder');
 assert.equal(fileReferenceName('file:///Applications/Example.app/'),'Example.app');
});
