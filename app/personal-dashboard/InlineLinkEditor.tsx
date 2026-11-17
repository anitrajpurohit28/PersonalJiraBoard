"use client";
import { cloneElement, useLayoutEffect, useRef, type ReactElement, type HTMLAttributes } from "react";
import { textLinks } from "../../lib/text-links.mjs";

// Keep the native input (and its caret/undo behavior) while drawing links at
// exactly the same positions. Only anchors receive pointer events in the mirror.
export function InlineLinkEditor({value,children,singleLine=false}:{value:string;children:ReactElement<HTMLAttributes<HTMLInputElement|HTMLTextAreaElement>>;singleLine?:boolean}){
  const root=useRef<HTMLDivElement>(null),mirror=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
  const parts=textLinks(value),linked=parts.some(part=>part.href);
  useLayoutEffect(()=>{
    const input=root.current?.querySelector('input,textarea'),layer=mirror.current;if(!input||!layer)return;
    const style=getComputedStyle(input);
    for(const key of ['font','lineHeight','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','textIndent','textAlign','tabSize'] as const)layer.style[key]=style[key];
    const sync=()=>{if(content.current)content.current.style.transform=`translate(${-input.scrollLeft}px,${-input.scrollTop}px)`;};
    sync();input.addEventListener('scroll',sync);return()=>input.removeEventListener('scroll',sync);
  });
  return <div ref={root} className={`inline-link-editor${linked?' has-inline-links':''}${singleLine?' inline-link-single':''}`}>
    {cloneElement(children,{className:`${children.props.className||''} inline-link-input`})}
    {linked?<div ref={mirror} className="inline-link-mirror" aria-hidden="true"><div ref={content}>{parts.map((part,index)=>part.href?<a key={index} href={part.href} target="_blank" rel="noopener noreferrer" tabIndex={-1} onClick={event=>{const selection=window.getSelection();if(selection&&!selection.isCollapsed)event.preventDefault();}}>{part.text}</a>:part.text)}{!singleLine?'\u200b':null}</div></div>:null}
  </div>;
}
