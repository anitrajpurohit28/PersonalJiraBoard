"use client";
import { useEffect, useState } from "react";
import { requestJson } from "./api";
type Uploaded = { id:string;filename:string;size:number };
export function JiraUploadedFiles({ taskId, onChanged }: {taskId:number;onChanged:()=>Promise<void>}) {
  const [files,setFiles]=useState<Uploaded[]>([]),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;const load=()=>{void requestJson(`/api/tasks/${taskId}/details`).then(data=>{if(!cancelled)setFiles(data.attachments || []);}).catch(()=>{});};load();const timer=window.setInterval(load,15000);return()=>{cancelled=true;window.clearInterval(timer);};},[taskId]);
  if(!files.length)return null;
  return <details className="jira-upload-section"><summary>Jira files ({files.length})</summary>{files.map(file=><div className="attachment-entry" key={file.id}><a href={`/api/tasks/${taskId}/attachments/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer">{file.filename}</a><button type="button" className="danger" onClick={()=>{if(!window.confirm(`Delete the attachment “${file.filename}” from Jira?`))return;void requestJson(`/api/tasks/${taskId}/activity`,{method:"POST",body:JSON.stringify({action:"attachment-delete",attachmentId:String(file.id),confirmDelete:true})}).then(async()=>{setFiles(current=>current.filter(row=>row.id!==file.id));await onChanged();}).catch(error=>setError(error.message));}}>Remove</button></div>)}{error?<p className="notice error" role="alert">{error}</p>:null}</details>;
}
