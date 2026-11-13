"use client";
import { useRef, useState, type DragEvent } from "react";
import { areaChoices, moveAreaChoice, type TaskArea } from "../../lib/task-areas";

export function AreaSwitcher({ areas, value, onChange, onManage, managed, counts, onReorder, saving=false }: { areas: TaskArea[]; counts: ReadonlyMap<string, number>; managed?: boolean; value: string; onChange: (id: string) => void; onManage: () => void; onReorder: (ids:string[])=>Promise<void>; saving?:boolean }) {
  const source=useRef<string|null>(null),skipClick=useRef(false);
  const [dragging,setDragging]=useState<string|null>(null),[target,setTarget]=useState<{id:string;after:boolean}|null>(null);
  const choices=areaChoices(areas),ids=choices.map(area=>area.id);
  function finish(){source.current=null;setDragging(null);setTarget(null);}
  function over(event:DragEvent<HTMLButtonElement>,id:string){
    if(source.current===null||saving)return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="move";
    const bounds=event.currentTarget.getBoundingClientRect();setTarget({id,after:event.clientX>bounds.left+bounds.width/2});
  }
  return <nav className="area-switcher" aria-label="Areas" aria-busy={saving}>
    <div className="area-options" role="group" aria-label="Choose area">
      {choices.map(area=><button type="button" key={area.id} data-area-id={area.id} draggable={!saving&&choices.length>1} title={`${area.name} · Drag to rearrange · Alt+Left/Right to move`} className={`${dragging===area.id?"area-dragging ":""}${target?.id===area.id&&target.id!==dragging?target.after?"area-drop-after":"area-drop-before":""}`} aria-pressed={value===area.id}
        onPointerDown={()=>{skipClick.current=false;}}
        onClick={event=>{if(skipClick.current&&event.detail!==0){skipClick.current=false;return;}onChange(area.id);}}
        onDragStart={event=>{source.current=area.id;skipClick.current=true;setDragging(area.id);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/x-personal-jira-area",JSON.stringify({id:area.id}));}}
        onDragOver={event=>over(event,area.id)} onDragEnd={finish}
        onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setTarget(null);}}
        onDrop={event=>{
          if(source.current===null||saving)return;
          event.preventDefault();event.stopPropagation();
          const bounds=event.currentTarget.getBoundingClientRect(),next=moveAreaChoice(ids,source.current,area.id,event.clientX>bounds.left+bounds.width/2);
          finish();if(next.some((id,index)=>id!==ids[index]))void onReorder(next);
        }}
        onKeyDown={event=>{
          if(saving||!event.altKey||event.ctrlKey||event.metaKey||!["ArrowLeft","ArrowRight"].includes(event.key))return;
          event.preventDefault();const index=ids.indexOf(area.id),other=ids[index+(event.key==="ArrowLeft"?-1:1)];
          if(other!==undefined)void onReorder(moveAreaChoice(ids,area.id,other,event.key==="ArrowRight"));
        }}><span>{area.name} ({counts.get(area.id)||0})</span></button>)}
    </div>
    <button type="button" className="area-manage" onClick={onManage} aria-label="Manage areas" title={managed ? "View Jira Area choices" : "Create, rename or remove areas"}>{managed ? "Areas" : "+ Area"}</button>
  </nav>;
}
