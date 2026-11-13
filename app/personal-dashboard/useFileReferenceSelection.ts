"use client";
import { descriptionDeleteDirection } from "../../lib/description-document.mjs";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Native DOM selection makes filename/path text behave like ordinary selectable text.
function selectedLinks(root: HTMLElement | null) {
  const selection=window.getSelection();
  if(!root||!selection||selection.isCollapsed||!selection.rangeCount)return [];
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return [];
  return Array.from(root.querySelectorAll<HTMLAnchorElement>("[data-file-reference-link]")).filter(link=>{
    const nodes=document.createTreeWalker(link,NodeFilter.SHOW_TEXT);
    while(nodes.nextNode()){
      const text=nodes.currentNode;
      if(!range.intersectsNode(text))continue;
      const start=range.startContainer===text?range.startOffset:0,end=range.endContainer===text?range.endOffset:text.textContent?.length??0;
      if(end>start)return true;
    }
    return false;
  });
}
const editableTarget=(target:EventTarget|null)=>target instanceof HTMLElement&&(target.matches("input, textarea")||target.isContentEditable);
export function useFileReferenceSelection(disabled:boolean,onDelete:(ids:string[])=>void){
  const root=useRef<HTMLDivElement>(null),callback=useRef(onDelete),disabledRef=useRef(disabled),selectedRef=useRef<string[]>([]);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  useLayoutEffect(()=>{callback.current=onDelete;disabledRef.current=disabled;});
  const clear=useCallback(()=>{
    if(selectedLinks(root.current).length)window.getSelection()?.removeAllRanges();
    selectedRef.current=[];setSelectedIds(previous=>previous.length?[]:previous);
  },[]);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const links=()=>Array.from(element.querySelectorAll<HTMLAnchorElement>('[data-file-reference-link]'));
    const linkId=(link:HTMLAnchorElement)=>link.closest<HTMLElement>('[data-description-block]')?.dataset.descriptionBlock;
    const liveIds=()=>selectedLinks(element).flatMap(link=>{const id=linkId(link);return id?[id]:[];});
    const ids=()=>{
      const live=liveIds();if(live.length)return live;
      const present=new Set(links().map(linkId));return selectedRef.current.filter(id=>present.has(id));
    };
    const refresh=()=>{
      // Attachment selection is atomic. WebKit may collapse its text Range before
      // delivering a native delete command; the blue rows still own that selection.
      const next=ids();selectedRef.current=next;
      setSelectedIds(previous=>previous.length===next.length&&previous.every((id,index)=>id===next[index])?previous:next);
    };
    const focusSelection=()=>{
      const selection=window.getSelection();if(!selection||!selection.rangeCount||!ids().length)return;
      const range=selection.getRangeAt(0).cloneRange();element.focus({preventScroll:true});selection.removeAllRanges();selection.addRange(range);refresh();
    };
    const remove=(selected:string[])=>{clear();callback.current(selected);};
    const keydown=(event:globalThis.KeyboardEvent)=>{
      if(disabledRef.current||event.defaultPrevented||event.isComposing||editableTarget(event.target)||!descriptionDeleteDirection(event))return;
      const selected=ids();if(!selected.length)return;
      event.preventDefault();event.stopPropagation();remove(selected);
    };
    const beforeInput=(event:InputEvent)=>{
      if(disabledRef.current||event.isComposing||editableTarget(event.target)||!["deleteContentBackward","deleteContentForward"].includes(event.inputType))return;
      const selected=ids();if(!selected.length)return;
      event.preventDefault();event.stopPropagation();remove(selected);
    };
    const outsideClick=(event:MouseEvent)=>{
      if(!(event.target instanceof Element))return;
      if(!element.contains(event.target)||!event.target.closest('[data-file-reference-link],.description-delete-selected'))clear();
    };
    const clipboard=(event:ClipboardEvent)=>{
      if(editableTarget(event.target)||event.type==="cut"&&disabledRef.current)return;
      const selected=new Set(ids()),chosen=links().filter(link=>selected.has(linkId(link)||""));if(!chosen.length||!event.clipboardData)return;
      event.preventDefault();event.clipboardData.setData("text/plain",chosen.map(link=>link.href).join("\n"));
      if(event.type==="cut")remove(ids());
    };
    const focusInput=(event:FocusEvent)=>{if(editableTarget(event.target))clear();};
    let drag:{link:HTMLAnchorElement;x:number;y:number}|null=null;
    const startDrag=(event:MouseEvent)=>{
      if(event.button!==0||!(event.target instanceof Element))return;
      const link=event.target.closest<HTMLAnchorElement>('[data-file-reference-link]');if(!link)return;
      // Own attachment dragging so WebKit never treats it as a URL drag or a click.
      event.preventDefault();clear();element.focus({preventScroll:true});
      drag={link,x:event.clientX,y:event.clientY};element.dataset.fileSelecting="";
    };
    const moveDrag=(event:MouseEvent)=>{
      if(!drag||Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;
      const links=Array.from(element.querySelectorAll<HTMLAnchorElement>('[data-file-reference-link]'));
      const hit=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('[data-file-reference-link]'):null;
      const end=hit&&element.contains(hit)?hit:links.reduce<HTMLAnchorElement|null>((nearest,link)=>{
        const rect=link.getBoundingClientRect(),other=nearest?.getBoundingClientRect();
        return !other||Math.abs(event.clientY-(rect.top+rect.bottom)/2)<Math.abs(event.clientY-(other.top+other.bottom)/2)?link:nearest;
      },null);
      const start=links.indexOf(drag.link),finish=end?links.indexOf(end):-1;if(start<0||finish<0)return;
      const range=document.createRange();range.setStartBefore(links[Math.min(start,finish)]);range.setEndAfter(links[Math.max(start,finish)]);
      const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);refresh();event.preventDefault();
    };
    const endDrag=()=>{drag=null;delete element.dataset.fileSelecting;};
    document.addEventListener("selectionchange",refresh);
    document.addEventListener("keydown",keydown,true);
    document.addEventListener("beforeinput",beforeInput,true);document.addEventListener("mousedown",outsideClick,true);
    document.addEventListener("copy",clipboard);document.addEventListener("cut",clipboard);
    element.addEventListener("mousedown",startDrag);document.addEventListener("mousemove",moveDrag);document.addEventListener("mouseup",endDrag);
    element.addEventListener("pointerup",focusSelection);document.addEventListener("focusin",focusInput);
    return()=>{
      document.removeEventListener("selectionchange",refresh);document.removeEventListener("keydown",keydown,true);
      document.removeEventListener("beforeinput",beforeInput,true);document.removeEventListener("mousedown",outsideClick,true);
      document.removeEventListener("copy",clipboard);document.removeEventListener("cut",clipboard);
      element.removeEventListener("mousedown",startDrag);document.removeEventListener("mousemove",moveDrag);document.removeEventListener("mouseup",endDrag);
      element.removeEventListener("pointerup",focusSelection);document.removeEventListener("focusin",focusInput);
    };
  },[clear]);
  return {root,selectedIds,clear};
}
