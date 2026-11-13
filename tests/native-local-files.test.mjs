import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeFiles, hasNativeFiles } from '../app/personal-dashboard/native-local-files.ts';
function windowsHost(run) {
 const previous=globalThis.window,host=new EventTarget();
 host.setTimeout=setTimeout;host.clearTimeout=clearTimeout;
 const calls=[];
 const reply=(body,values)=>{const event=new Event('task-board-files-response');event.detail={requestId:body.requestId,...values};host.dispatchEvent(event);};
 host.chrome={webview:{postMessage(body){calls.push({body});},postMessageWithAdditionalObjects(body,files){calls.push({body,files});}}};
 globalThis.window=host;
 return Promise.resolve().then(()=>run({host,calls,reply})).finally(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
}
test('Windows file picker uses the WebView2 bridge and accepts multiple drive paths and folders',()=>windowsHost(async({calls,reply})=>{
 assert.equal(hasNativeFiles(),true);const pending=nativeFiles('choose');assert.equal(calls.length,1);assert.equal(calls[0].body.type,'task-files');assert.equal(calls[0].body.action,'choose');assert.match(calls[0].body.requestId,/^[a-f0-9-]{36}$/);
 const files=['file:///C:/Users/Example/One%20file.pdf','file:///D:/Projects/Folder/'];reply(calls[0].body,{files});assert.deepEqual((await pending).files,files);
}));
test('Windows drop sends original DOM File objects separately from JSON without uploading file bytes',()=>windowsHost(async({calls,reply})=>{
 const files=[new File(['test'],'One.txt'),new File(['test'],'Two.txt')];const pending=nativeFiles('resolve-drop',{names:files.map(file=>file.name)},files);
 assert.equal(calls[0].files,files);assert.deepEqual(calls[0].body.names,['One.txt','Two.txt']);assert.equal('files' in calls[0].body,false);
 reply(calls[0].body,{files:['file:///C:/One.txt','file:///C:/Two.txt']});assert.equal((await pending).files.length,2);
}));
test('Windows native requests match concurrent status and open replies by ID',()=>windowsHost(async({calls,reply})=>{
 const status=nativeFiles('status',{urls:['file:///C:/One.txt']}),open=nativeFiles('open',{url:'file:///C:/One.txt'});
 reply(calls[1].body,{opened:true});reply(calls[0].body,{exists:{'file:///C:/One.txt':false}});
 assert.deepEqual(await status,{requestId:calls[0].body.requestId,exists:{'file:///C:/One.txt':false}});assert.equal((await open).opened,true);
}));
test('Windows native errors and older WebView2 drop support reject cleanly',()=>windowsHost(async({host,calls,reply})=>{
 const pending=nativeFiles('choose');reply(calls[0].body,{error:'Picker failed'});await assert.rejects(pending,/Picker failed/);
 delete host.chrome.webview.postMessageWithAdditionalObjects;
 await assert.rejects(nativeFiles('resolve-drop',{names:['One.txt']},[new File(['test'],'One.txt')]),/Update Microsoft Edge WebView2/);
}));
