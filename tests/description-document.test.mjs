import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDescriptionDocument, descriptionEditingBlocks, writeDescriptionDocument, insertDescriptionBlocks, toggleDescriptionCheck, removeDescriptionFiles, descriptionDeleteDirection, adjacentDescriptionFile } from '../lib/description-document.mjs';
import { toAdf, descriptionText } from '../lib/jira-fields.mjs';
import { jiraFixture } from './jira-fixture.mjs';
test('mixed notes, multiple checklists, files and folders round trip without changing text whitespace',()=>{
 const text='Notes with spaces  \n\nfile:///Users/example/Document.pdf\nfile:///Users/example/Folder/\n\n- [ ] Call somebody\n- [x] Finished\n\nMore notes\n- [ ] Another checklist\n';
 const blocks=parseDescriptionDocument(text);
 assert.deepEqual(blocks.map(block=>block.type),['text','file','file','text','check','check','text','check','text']);
 assert.equal(writeDescriptionDocument(blocks),text);
 assert.equal(descriptionText(toAdf(text,{checklist:true})),text);
 for(const body of ['', '  ', '\n\n', 'First  \nSecond\n'])assert.equal(writeDescriptionDocument(parseDescriptionDocument(body)),body);
});
test('inserting a checklist at the caret preserves the surrounding notes and selected text',()=>{
 const blocks=parseDescriptionDocument('Before after'),id=blocks[0].id;
 const next=insertDescriptionBlocks(blocks,{id,start:7,end:7},[{id:'check',type:'check',text:'An item',done:false}]);
 assert.equal(writeDescriptionDocument(next),'Before \n- [ ] An item\nafter');
 const selection=insertDescriptionBlocks(blocks,{id,start:7,end:12},[{id:'check',type:'check',text:'after',done:false}]);
 assert.equal(writeDescriptionDocument(selection),'Before \n- [ ] after\n');
});
test('completion sinks within its checklist without moving notes, folders or another checklist',()=>{
 const blocks=parseDescriptionDocument('Notes\n- [ ] First\n- [ ] Second\nfile:///Users/me/Folder/\n- [ ] Separate');
 const changed=toggleDescriptionCheck(blocks,blocks[1].id,true);
 assert.equal(writeDescriptionDocument(changed),'Notes\n- [ ] Second\n- [x] First\nfile:///Users/me/Folder/\n- [ ] Separate');
 assert.equal(writeDescriptionDocument(blocks),'Notes\n- [ ] First\n- [ ] Second\nfile:///Users/me/Folder/\n- [ ] Separate');
});
test('blank paragraphs do not create checkboxes and only filled checklist items are persisted',()=>{
 const blocks=parseDescriptionDocument('Text\n\n- [ ]\n- [ ] Item\n\n');
 assert.equal(blocks.filter(block=>block.type==='check').length,1);
 assert.equal(writeDescriptionDocument([{id:'blank',type:'check',text:'',done:false}]),'');
});
test('mixed descriptions survive offline restart and Jira sync, including duplicate links and folders',async()=>{
 const fixture=jiraFixture(),client=await fixture.makeClient().initialise(),workspace=fixture.makeWorkspace();await workspace.prime(client);await workspace.synchronize(client);
 const value='Notes  \n\nfile:///Users/me/Folder/\nfile:///Users/me/report.pdf\nfile:///Users/me/report.pdf\n\n- [ ] Item\n- [x] Finished\n\nEnding notes\n';
 await workspace.update('KAN-1',{fields:{description:value}});const restored=fixture.makeWorkspace();await restored.load();await restored.synchronize(client);
 assert.equal(descriptionText(fixture.issues.get('KAN-1').fields.description),value);
 assert.equal(writeDescriptionDocument(parseDescriptionDocument(value)),value);assert.equal(restored.queueSummary().pending,0);assert.equal(fixture.files.size,0);
});

test('files followed by checklist retain insertion positions before, between and after every item on reopening',()=>{
 const value='file:///Users/me/First.pdf\nfile:///Users/me/Folder/\n- [ ] First\n- [ ] Second';
 const blocks=parseDescriptionDocument(value),editing=descriptionEditingBlocks(blocks);
 assert.equal(editing.filter(block=>block.insertion).length,5);
 assert.equal(editing[0].beforeId,blocks[0].id);assert.equal(editing.at(-1).beforeId,null);
 assert.deepEqual(descriptionEditingBlocks(blocks),editing); // Stable IDs retain the focused DOM input.
 assert.equal(writeDescriptionDocument(blocks),value); // Merely opening never edits the description.
 for(const point of editing.filter(block=>block.insertion)){
   const inserted=insertDescriptionBlocks(blocks,point,[{id:'notes',type:'text',text:'My notes  \nSecond line'}]);
   const index=inserted.findIndex(block=>block.id==='notes');
   assert.equal(inserted[index+1]?.id??null,point.beforeId);
   assert.ok(writeDescriptionDocument(parseDescriptionDocument(writeDescriptionDocument(inserted))).includes('My notes  \nSecond line'));
   for(const type of ['file','check']){
     const added=type==='file'?{id:'new',type,url:'file:///Users/me/New.pdf'}:{id:'new',type,text:'New item',done:false};
     const next=insertDescriptionBlocks(blocks,point,[added]),position=next.findIndex(block=>block.id==='new');
     assert.equal(next[position+1]?.id??null,point.beforeId);
   }
 }
});
test('editor-only text positions do not split checklist completion ordering or duplicate existing notes',()=>{
 const blocks=parseDescriptionDocument('Notes\n- [ ] One\n- [ ] Two\nEnd');
 const editing=descriptionEditingBlocks(blocks);
 assert.equal(editing.filter(block=>block.insertion).length,1);
 assert.equal(writeDescriptionDocument(toggleDescriptionCheck(blocks,blocks[1].id,true)),'Notes\n- [ ] Two\n- [x] One\nEnd');
});

test('mouse-selected attachment removal preserves notes, checklists and unselected duplicate references',()=>{
 const blocks=parseDescriptionDocument('Notes\nfile:///Users/me/Same.pdf\nfile:///Users/me/Folder/\nfile:///Users/me/Same.pdf\n- [ ] Keep me\nEnding notes');
 const files=blocks.filter(block=>block.type==='file');
 const next=removeDescriptionFiles(blocks,[files[0].id,files[1].id,blocks[0].id]);
 assert.equal(writeDescriptionDocument(next),'Notes\nfile:///Users/me/Same.pdf\n- [ ] Keep me\nEnding notes');
 assert.equal(blocks.filter(block=>block.type==='file').length,3);
 assert.equal(writeDescriptionDocument(removeDescriptionFiles(blocks,files.map(file=>file.id))),'Notes\n- [ ] Keep me\nEnding notes');
 assert.deepEqual(removeDescriptionFiles(blocks,['stale']),blocks);
});

test('Mac Backspace and Windows Delete remove adjacent file references at a text cursor boundary',()=>{
 const blocks=parseDescriptionDocument('Before\nfile:///C:/Users/Example/First.pdf\nfile:///Users/example/Folder/\nAfter');
 const gap=descriptionEditingBlocks(blocks).find(block=>block.insertion);
 assert.equal(adjacentDescriptionFile(blocks,gap.id,-1),blocks[1].id);
 assert.equal(adjacentDescriptionFile(blocks,gap.id,1),blocks[2].id);
 assert.equal(adjacentDescriptionFile(blocks,blocks[0].id,1),blocks[1].id);
 assert.equal(adjacentDescriptionFile(blocks,blocks.at(-1).id,-1),blocks[2].id);
 assert.equal(adjacentDescriptionFile(blocks,blocks[0].id,-1),null);
 assert.equal(adjacentDescriptionFile(blocks,'missing',-1),null);
 for(const event of [{key:'Backspace'},{code:'Backspace'},{key:'Unidentified',keyCode:8}])assert.equal(descriptionDeleteDirection(event),-1);
 for(const event of [{key:'Delete'},{code:'Delete'},{key:'Unidentified',keyCode:46}])assert.equal(descriptionDeleteDirection(event),1);
 for(const modifier of ['metaKey','ctrlKey','altKey','isComposing'])assert.equal(descriptionDeleteDirection({key:'Backspace',[modifier]:true}),0);
 assert.equal(descriptionDeleteDirection({key:'a'}),0);
});
