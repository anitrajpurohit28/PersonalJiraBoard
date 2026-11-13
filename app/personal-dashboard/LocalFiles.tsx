"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type DragEvent, type MouseEvent } from 'react';
import { descriptionParts, addDescriptionFiles, descriptionWithFiles, localFileUrl, fileReferenceName } from '../../lib/local-file-references.mjs';
import { hasNativeFiles, nativeFiles } from './native-local-files';
export function LocalFileLink({ url, onRemove, showPath=false, selectable=false }: { url: string; onRemove?: () => void; showPath?:boolean; selectable?:boolean }) {
  const [exists,setExists] = useState<boolean | null>(null), [error,setError] = useState('');
  useEffect(() => { let cancelled=false;
    function check() { if (!hasNativeFiles()) {setExists(false);return;} void nativeFiles('status',{urls:[url]}).then(reply=>{if(!cancelled)setExists(Boolean(reply.exists?.[url]));}).catch(()=>{if(!cancelled)setExists(false);}); }
    check();window.addEventListener('focus',check);return()=>{cancelled=true;window.removeEventListener('focus',check);};
  },[url]);
  const content=<>{url.endsWith("/")?"📁":"📄"} {fileReferenceName(url)}{showPath?<small className="local-file-path">{url}</small>:null}</>;
  const linkProps={className:"local-file-link",title:url,draggable:false,"aria-label":`${url.endsWith("/")?"Folder":"File"}: ${fileReferenceName(url)}`,onClick:(event:MouseEvent)=>{
    event.preventDefault();
    // A mouse drag selects references; it must never open a file on mouse-up.
    const selection=window.getSelection();if(selectable&&selection&&!selection.isCollapsed)return;
    setError('');if(!hasNativeFiles()){setExists(false);return;}
    void nativeFiles('open',{url}).then(reply=>{setExists(Boolean(reply.opened));}).catch(error=>setError(error.message));
  }};
  return <span className="local-file-reference"><span className="local-file-main">{selectable?<a href={url} data-file-reference-link="" {...linkProps}>{content}</a>:<button type="button" {...linkProps}>{content}</button>}{exists===false ? <small>file is missing on this device</small> : exists===null ? <small>Checking file…</small> : null}{error ? <small role="alert">{error}</small> : null}</span>{onRemove ? <button type="button" aria-label={`Remove file reference ${fileReferenceName(url)}`} onClick={onRemove}>×</button> : null}</span>;

}
export function FileDropZone({ onFiles, disabled, children, label }: { onFiles: (files:string[], target?:HTMLElement)=>void; disabled:boolean; children:ReactNode; label:string }) {
  const [dragging,setDragging]=useState(false),[error,setError]=useState('');
  async function drop(event: DragEvent) {
    const files=Array.from(event.dataTransfer.files), nativeDrop=event.dataTransfer.types.includes('Files'), raw=event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if(!nativeDrop&&!files.length&&!/^file:\/\//i.test(raw.trim()))return;
    event.preventDefault();event.stopPropagation();setDragging(false);if(disabled)return;setError('');
    try {
      if(nativeDrop||files.length){const reply=await nativeFiles('resolve-drop',{names:files.map(file=>file.name)},files);if(reply.files?.length)onFiles(reply.files,event.target as HTMLElement);else throw new Error('Drop files or folders from Finder or File Explorer.');}
      else {const urls=raw.split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#')).map(localFileUrl);if(urls.length)onFiles(urls,event.target as HTMLElement);}
    }catch(error){setError((error as Error).message);}
  }
  return <div className={`local-file-drop${dragging?' file-dragging':''}`} aria-label={label} onDragOver={event=>{if(disabled)return;if(event.dataTransfer.types.includes('Files')||event.dataTransfer.types.includes('text/uri-list')){event.preventDefault();event.stopPropagation();setDragging(true);event.dataTransfer.dropEffect='copy';}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}} onDrop={event=>void drop(event)}>{children}{dragging?<div className="file-drop-hint">Drop to link files</div>:null}{error?<p className="notice error" role="alert">{error}</p>:null}</div>;
}
export function LocalFileAttachments({ value, onChange, disabled }: { value:string; onChange:(value:string)=>void; disabled:boolean; compact?:boolean }) {
  const parts=descriptionParts(value),[error,setError]=useState('');
  const current=useRef(value);useLayoutEffect(()=>{current.current=value;},[value]);
  function add(files:string[]) {
    const next=addDescriptionFiles(current.current,files);
    if(next.length>32000)throw new Error('The description exceeds 32,000 characters.');
    onChange(next);setError('');
  }
  return <FileDropZone disabled={disabled} label="Description file attachments" onFiles={add}>
    <div className="local-file-list">{parts.files.map(url=><LocalFileLink key={url} url={url} onRemove={disabled?undefined:()=>onChange(descriptionWithFiles(parts.body,parts.files.filter(file=>file!==url)))} />)}</div>
    <div className="local-file-actions"><button type="button" disabled={disabled} onClick={()=>{
      setError('');
      if(!hasNativeFiles()){setError('Open the desktop app to choose local files.');return;}
      void nativeFiles('choose').then(reply=>{if(reply.files?.length)add(reply.files);}).catch(error=>setError(error.message));
    }}>+ Add files</button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}
  </FileDropZone>;
}
