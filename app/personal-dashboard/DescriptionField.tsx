"use client";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { parseDescriptionDocument, descriptionEditingBlocks, writeDescriptionDocument, insertDescriptionBlocks, toggleDescriptionCheck, removeDescriptionFiles, descriptionDeleteDirection, adjacentDescriptionFile } from "../../lib/description-document.mjs";
import { readChecklistLine } from "../../lib/description-checklist.mjs";
import { localFileUrl } from "../../lib/local-file-references.mjs";
import { FileDropZone, LocalFileLink } from "./LocalFiles";
import { nativeFiles, hasNativeFiles } from "./native-local-files";
import { useFileReferenceSelection } from "./useFileReferenceSelection";
import { DraftLinks } from "./LinkedText";
type TextBlock={id:string;type:"text";text:string;insertion?:boolean;beforeId?:string|null};
type CheckBlock={id:string;type:"check";text:string;done:boolean};
type FileBlock={id:string;type:"file";url:string};
type Block=TextBlock|CheckBlock|FileBlock;
type Selection={id:string;start?:number;end?:number;beforeId?:string|null};
const textBlock=(text=""):TextBlock=>({id:crypto.randomUUID(),type:"text",text});
const checkBlock=(text="",done=false):CheckBlock=>({id:crypto.randomUUID(),type:"check",text,done});
export function DescriptionField({label,value,onChange,required,disabled}:{label:string;value:string;onChange:(value:string)=>void;required:boolean;disabled:boolean}) {
  const [model,setModel]=useState(()=>({value,blocks:parseDescriptionDocument(value) as Block[]})),[error,setError]=useState("");
  const latest=useRef(model),selection=useRef<Selection|null>(null),pending=useRef<{id:string;position?:number}|null>(null),inputs=useRef(new Map<string,HTMLTextAreaElement|HTMLInputElement>());
  const labelId=useId();
  const editingBlocks=descriptionEditingBlocks(model.blocks) as Block[];
  const history=useRef<{past:Block[][];future:Block[][];lastText:number}>({past:[],future:[],lastText:0});
  if(model.value!==value)setModel({value,blocks:parseDescriptionDocument(value) as Block[]});
  useLayoutEffect(()=>{
    latest.current=model;
    for(const input of inputs.current.values())if(input instanceof HTMLTextAreaElement){input.style.height="0px";input.style.height=`${Math.max(input.scrollHeight,32)}px`;}
    if(pending.current){const input=inputs.current.get(pending.current.id);if(input){input.focus();const position=pending.current.position??input.value.length;input.setSelectionRange(position,position);}pending.current=null;}
  });
  function change(blocks:Block[],typing=false,record=true) {
    if(!blocks.length)blocks=[textBlock()];
    const next=writeDescriptionDocument(blocks);
    if(next.length>32000){setError("The description exceeds 32,000 characters.");return;}
    // This function runs only in input handlers; timing groups typing into one undo step.
    if(record){const now=Date.now();if(!typing||now-history.current.lastText>650)history.current.past.push(latest.current.blocks);if(history.current.past.length>100)history.current.past.shift();history.current.future=[];history.current.lastText=typing?now:0;}
    const state={value:next,blocks};latest.current=state;setModel(state);setError("");onChange(next);
  }
  function deleteFiles(ids:string[]){
    const blocks=latest.current.blocks,first=blocks.findIndex(block=>block.type==="file"&&ids.includes(block.id));
    let next=removeDescriptionFiles(blocks,ids) as Block[];
    if(next.length===blocks.length)return;
    if(!next.length)next=[textBlock()];
    const following=blocks.slice(first+1).find(block=>!ids.includes(block.id));
    const writing=descriptionEditingBlocks(next) as Block[];
    const point=writing.find(block=>block.type==="text"&&(block.id===following?.id||block.insertion&&block.beforeId===(following?.id??null)))||writing.find(block=>block.type==="text");
    if(point)pending.current={id:point.id,position:0};
    change(next);
  }
  const {root: fileRootRef,selectedIds: selectedFileIds,clear: clearFileSelection}=useFileReferenceSelection(disabled,deleteFiles);
  function remember(block:Block,input:HTMLInputElement|HTMLTextAreaElement){selection.current={id:block.id,start:input.selectionStart??0,end:input.selectionEnd??0,...(block.type==="text"&&block.insertion?{beforeId:block.beforeId}: {})};}
  function update(block:TextBlock|CheckBlock,text:string){
    if(block.type==="text"&&block.insertion){
      change(insertDescriptionBlocks(latest.current.blocks,{id:block.id,beforeId:block.beforeId},[{id:block.id,type:"text",text}]) as Block[],true);
    }else change(latest.current.blocks.map(row=>row.id===block.id?{...row,text}:row),true);
  }
  function remove(id:string){change(latest.current.blocks.filter(block=>block.id!==id));}
  function insertChecklist(){
    const blocks=latest.current.blocks,where=selection.current,current=blocks.find(block=>block.id===where?.id);
    const selected=current?.type==="text"?current.text.slice(where?.start??0,where?.end??0):"";
    const items=selected.trim()?selected.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const item=readChecklistLine(line);return checkBlock(item?.text??line,item?.done??false);}):[checkBlock()];
    pending.current={id:items[0].id,position:0};change(insertDescriptionBlocks(blocks,where,items) as Block[]);
  }
  function attach(files:string[],target?:HTMLElement){
    const blocks=latest.current.blocks,id=target?.closest<HTMLElement>('[data-description-block]')?.dataset.descriptionBlock;
    const targetBlock=editingBlocks.find(block=>block.id===id);
    const where=id?selection.current?.id===id?selection.current:{id,...(targetBlock?.type==="text"&&targetBlock.insertion?{beforeId:targetBlock.beforeId}: {})}:selection.current;
    const added:FileBlock[]=files.map(url=>({id:crypto.randomUUID(),type:"file",url:localFileUrl(url)}));
    const next=insertDescriptionBlocks(blocks,where,added) as Block[];
    const last=next.findIndex(block=>block.id===added.at(-1)?.id);
    let after=next[last+1];
    if(!after||after.type!=="text"){after=textBlock();next.splice(last+1,0,after);}
    pending.current={id:after.id,position:0};selection.current={id:after.id,start:0,end:0};
    change(next);
  }
  function checkKeys(event:KeyboardEvent<HTMLInputElement>,block:CheckBlock){
    if(event.nativeEvent.isComposing)return;
    if(event.key==="Enter"){
      event.preventDefault();const blocks=[...latest.current.blocks],index=blocks.findIndex(row=>row.id===block.id);
      if(!block.text.trim()){
        const next=textBlock();blocks.splice(index,1,next);pending.current={id:next.id,position:0};change(blocks);
      }else{
        const start=event.currentTarget.selectionStart??block.text.length,end=event.currentTarget.selectionEnd??start;
        const next=checkBlock(block.text.slice(end));blocks.splice(index,1,{...block,text:block.text.slice(0,start)},next);pending.current={id:next.id,position:0};change(blocks);
      }
    }else if(event.key==="Backspace"&&!block.text){event.preventDefault();const next=textBlock();pending.current={id:next.id,position:0};change(latest.current.blocks.map(row=>row.id===block.id?next:row));}
  }
  function descriptionKey(event:KeyboardEvent){
    const direction=descriptionDeleteDirection(event.nativeEvent),input=event.target;
    if(direction&&input instanceof HTMLElement&&input.matches('textarea,input[type=text]')){
      const field=input as HTMLInputElement|HTMLTextAreaElement,start=field.selectionStart,end=field.selectionEnd;
      if(!disabled&&start===end&&start===(direction<0?0:field.value.length)){
        const id=input.closest<HTMLElement>('[data-description-block]')?.dataset.descriptionBlock;
        const fileId=id?adjacentDescriptionFile(latest.current.blocks,id,direction):null;
        if(fileId){
          event.preventDefault();event.stopPropagation();deleteFiles([fileId]);
          if(latest.current.blocks.some(block=>block.id===id))pending.current={id:id!,position:start??0};
          return;
        }
      }
    }
    undo(event);
  }
  function undo(event:KeyboardEvent){
    if(!(event.metaKey||event.ctrlKey)||event.altKey||event.key.toLowerCase()!=="z")return;
    event.preventDefault();const source=event.shiftKey?history.current.future:history.current.past,destination=event.shiftKey?history.current.past:history.current.future;
    const blocks=source.pop();if(!blocks)return;destination.push(latest.current.blocks);history.current.lastText=0;
    const active=event.target instanceof HTMLElement?event.target:null,id=active?.closest<HTMLElement>('[data-description-block]')?.dataset.descriptionBlock;
    const editable=descriptionEditingBlocks(blocks) as Block[];
    const focus=editable.find(block=>block.id===id&&block.type!=="file")||editable.find(block=>block.type!=="file");
    if(focus)pending.current={id:focus.id};
    change(blocks,false,false);
  }
  return <section className="description-unified" aria-labelledby={labelId}>
    <span id={labelId} className="description-label">{label}</span>
    <FileDropZone label="Description file drop" disabled={disabled} onFiles={attach}>
      <div ref={fileRootRef} tabIndex={-1} className={`description-document${model.blocks.length===1&&model.blocks[0].type==="text"?" description-notes-only":""}`} onKeyDown={descriptionKey}>
        {editingBlocks.map((block,index)=>block.type==="text"?<div className={`description-text-block${block.insertion?" description-insertion":""}${index===0||index===editingBlocks.length-1?" description-edge":""}`} data-description-block={block.id} key={block.id}>
          <textarea ref={node=>{if(node)inputs.current.set(block.id,node);else inputs.current.delete(block.id);}} aria-label={block.insertion?index===0?"Text before description content":index===editingBlocks.length-1?"Text after description content":`Insert text at position ${index+1}`:index===0?label:`Description text ${index+1}`} placeholder={block.insertion?index===0?"Write notes…":index===editingBlocks.length-1?"Write more notes…":"Write here…":index===0?"Notes…":""} rows={1} value={block.text} required={required&&!value.trim()&&index===0} disabled={disabled} maxLength={Math.max(0,32000-(value.length-block.text.length))} onChange={event=>{remember(block,event.currentTarget);update(block,event.target.value);}} onSelect={event=>remember(block,event.currentTarget)} onFocus={event=>remember(block,event.currentTarget)} />
          <DraftLinks text={block.text}/>
        </div>:block.type==="file"?<div key={block.id} className={selectedFileIds.includes(block.id)?"description-file-selected":""} data-description-block={block.id} onFocus={()=>{selection.current={id:block.id};}}><LocalFileLink url={block.url} showPath selectable onRemove={disabled?undefined:()=>remove(block.id)}/></div>:<div className={`description-check-row${block.done?' checklist-done':''}`} data-description-block={block.id} key={block.id}>
          <input type="checkbox" aria-label={`${block.done?'Reopen':'Complete'} ${block.text||'new checklist item'}`} checked={block.done} disabled={disabled||!block.text.trim()} onChange={event=>change(toggleDescriptionCheck(latest.current.blocks,block.id,event.target.checked) as Block[])}/>
          <div className="checklist-item-content"><input ref={node=>{if(node)inputs.current.set(block.id,node);else inputs.current.delete(block.id);}} type="text" aria-label={`Checklist item ${index+1}`} placeholder="Checklist item…" value={block.text} disabled={disabled} maxLength={Math.max(0,32000-(value.length-block.text.length))} onChange={event=>{remember(block,event.currentTarget);update(block,event.target.value);}} onSelect={event=>remember(block,event.currentTarget)} onFocus={event=>remember(block,event.currentTarget)} onKeyDown={event=>checkKeys(event,block)} onPaste={event=>{
            const pasted=event.clipboardData.getData('text').replace(/\r\n?/g,'\n');if(!pasted.includes('\n'))return;
            event.preventDefault();const input=event.currentTarget,text=block.text.slice(0,input.selectionStart??0)+pasted+block.text.slice(input.selectionEnd??block.text.length);
            const added=text.split('\n').filter(line=>line.trim()).map(line=>{const item=readChecklistLine(line);return checkBlock(item?.text??line,item?.done??block.done);}).filter(item=>item.text.trim());
            const blocks=[...latest.current.blocks],at=blocks.findIndex(row=>row.id===block.id);blocks.splice(at,1,...added);if(added.length)pending.current={id:added.at(-1)!.id};change(blocks);
          }}/><DraftLinks text={block.text}/></div>
          <button type="button" className="checklist-remove" aria-label={`Remove checklist item ${index+1}`} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>remove(block.id)}>×</button>
        </div>)}
        <div className="description-document-toolbar"><button type="button" title="Link files or folders" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{
          if(!hasNativeFiles()){setError('Open the desktop app to choose local files or folders.');return;}
          void nativeFiles('choose').then(reply=>{if(reply.files?.length)attach(reply.files);}).catch(error=>setError(error.message));
        }}>+ Add files</button>{selectedFileIds.length?<button type="button" className="danger description-delete-selected" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{deleteFiles(selectedFileIds);clearFileSelection();}}>Delete selected ({selectedFileIds.length})</button>:null}<button type="button" title="Insert checklist at the cursor" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={insertChecklist}>☷ Checklist</button></div>
      </div>
    </FileDropZone>
    {error?<p className="notice error" role="alert">{error}</p>:null}
  </section>;
}
