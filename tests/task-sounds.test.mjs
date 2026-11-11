import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { completedSince, createTaskSoundPlayer, SOUND_PATTERNS, renderTaskSound } from '../lib/task-sounds.mjs';

test('completion sounds ignore initial loading, imported Done tasks and unchanged refreshes', () => {
  const rows=[{id:1,archived:true},{id:2,archived:false}];
  assert.equal(completedSince(null,rows),false);
  assert.equal(completedSince(new Map([[1,true],[2,false]]),rows),false);
  assert.equal(completedSince(new Map([[1,false],[2,false]]),rows),true);
  assert.equal(completedSince(new Map(),rows),false);
});
test('native hosts receive the correct sound without creating browser audio', () => {
  const calls=[];const player=createTaskSoundPlayer({nativePlay: name=>{calls.push(name);return true;},createContext:()=>{throw new Error('Must use native host');}});
  player.play('complete');player.play('reminder');player.play('invalid');player.dispose();player.play('complete');
  assert.deepEqual(calls,['complete','reminder']);
});
test('a blocked browser reminder waits for interaction and plays once after resume', async () => {
  let unblock;const notes=[];
  const context={state:'suspended',currentTime:0,destination:{},resume:()=>new Promise(resolve=>{unblock=()=>{context.state='running';resolve();};}),close:async()=>{},createBuffer:(_channels,length)=>({getChannelData:()=>new Float32Array(length)}),createBufferSource:()=>({connect(){},disconnect(){},start(){notes.push('start');},stop(){}})};
  const player=createTaskSoundPlayer({createContext:()=>context});player.play('reminder');assert.equal(notes.length,0);
  player.unlock();unblock();await Promise.resolve();assert.equal(notes.length,1);
  player.unlock();unblock();await Promise.resolve();assert.equal(notes.length,1);player.dispose();
});
test('bundled native sounds are valid non-silent offline PCM audio, and alarms last longer than completion', async () => {
  const durations={};
  for(const name of ['complete','reminder']){const wav=await readFile(new URL(`../public/sounds/${name}.wav`,import.meta.url));assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt32LE(4),wav.length-8);assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(34),16);assert.ok(wav.subarray(44).some(byte=>byte!==0));durations[name]=(wav.length-44)/wav.readUInt32LE(28);}
  assert.equal(durations.complete,2.8);assert.equal(durations.reminder,15);
  assert.equal(SOUND_PATTERNS.complete.length,1);
  const samples=renderTaskSound("reminder");
  for(let second=0;second<15;second++){let energy=0;for(let i=second*44100;i<(second+1)*44100;i++)energy+=samples[i]*samples[i];assert.ok(energy>0.001,`Second ${second+1} must contain ringing`);}
  assert.ok(Math.abs(samples.at(-1))<0.001);
});
