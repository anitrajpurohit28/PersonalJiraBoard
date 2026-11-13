import { readChecklistLine } from './description-checklist.mjs';
import { standaloneFileReference, localFileUrl } from './local-file-references.mjs';
// Ordinary text, checkbox lines and file URLs share one portable Jira description.
export function parseDescriptionDocument(value, id = () => crypto.randomUUID()) {
  const blocks = [], text = [];
  const flush = () => { if (text.length) { blocks.push({id:id(),type:'text',text:text.join('\n')});text.length=0; } };
  for (const line of String(value || '').replace(/\r\n?/g,'\n').split('\n')) {
    const item=readChecklistLine(line), url=standaloneFileReference(line);
    if (item) {flush();if(item.text.trim())blocks.push({id:id(),type:'check',...item});}
    else if (url) {flush();blocks.push({id:id(),type:'file',url});}
    else text.push(line);
  }
  flush();return blocks.length ? blocks : [{id:id(),type:'text',text:''}];
}
// Empty insertion rows are editor-only: reopening must not add blank lines to Jira.
export function descriptionEditingBlocks(blocks) {
  const result = [];
  for (let index = 0; index <= blocks.length; index++) {
    const previous = blocks[index - 1], next = blocks[index];
    if (previous?.type !== 'text' && next?.type !== 'text') result.push({
      id: `insertion-${previous?.id || 'start'}-${next?.id || 'end'}`,
      type: 'text', text: '', insertion: true, beforeId: next?.id ?? null,
    });
    if (next) result.push(next);
  }
  return result;
}
export function writeDescriptionDocument(blocks) {
  return blocks.flatMap(block => block.type==='check' ? block.text.trim() ? [`- [${block.done?'x':' '}] ${block.text}`] : [] : [block.type==='file' ? localFileUrl(block.url) : block.text]).join('\n');
}
export function insertDescriptionBlocks(blocks, selection, added) {
  const index=blocks.findIndex(block=>block.id===selection?.id), current=blocks[index];
  if(current?.type==='text') {
    const start=Math.min(current.text.length,Math.max(0,selection.start ?? current.text.length)),end=Math.min(current.text.length,Math.max(start,selection.end ?? start));
    const before={...current,text:current.text.slice(0,start)},after={id:crypto.randomUUID(),type:'text',text:current.text.slice(end)};
    return [...blocks.slice(0,index),before,...added,after,...blocks.slice(index+1)];
  }
  const before=selection && Object.hasOwn(selection,'beforeId') ? blocks.findIndex(block=>block.id===selection.beforeId) : -1;
  const at=index>=0?index+1:before>=0?before:blocks.length;
  return [...blocks.slice(0,at),...added,...blocks.slice(at)];
}
export function toggleDescriptionCheck(blocks,id,done) {
  const index=blocks.findIndex(block=>block.id===id);if(index<0||blocks[index].type!=='check')return blocks;
  let first=index,last=index+1;while(first>0&&blocks[first-1].type==='check')first--;while(last<blocks.length&&blocks[last].type==='check')last++;
  const run=blocks.slice(first,last).map(block=>block.id===id?{...block,done}:block).sort((a,b)=>Number(a.done)-Number(b.done));
  return [...blocks.slice(0,first),...run,...blocks.slice(last)];
}

// References are atomic. Use IDs so selecting one duplicate never removes another.
export function removeDescriptionFiles(blocks, ids) {
  const selected = new Set(ids);
  return blocks.filter(block => block.type !== 'file' || !selected.has(block.id));
}

export function descriptionDeleteDirection(event) {
  if(event.isComposing || event.metaKey || event.ctrlKey || event.altKey)return 0;
  if(event.key==='Backspace' || event.code==='Backspace' || event.keyCode===8)return -1;
  if(event.key==='Delete' || event.code==='Delete' || event.keyCode===46)return 1;
  return 0;
}
export function adjacentDescriptionFile(blocks, id, direction) {
  const editing=descriptionEditingBlocks(blocks),index=editing.findIndex(block=>block.id===id);
  if(index<0 || ![-1,1].includes(direction))return null;
  let position=index+direction;
  while(editing[position]?.insertion)position+=direction;
  return editing[position]?.type==='file'?editing[position].id:null;
}
