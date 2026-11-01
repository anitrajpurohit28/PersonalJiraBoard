import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingAreaCounts,completedTaskWeeks} from '../lib/board-summary.ts';
const task=(id,completedAt,extra={})=>({id,jiraKey:`KAN-${id}`,completedAt,archived:true,...extra});
const group=(id,date,extra={})=>({key:`KAN-${id}`,parent:task(id,date),children:[],matches:[task(id,date)],...extra});
function zone(name,run){const before=process.env.TZ;process.env.TZ=name;try{run();}finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}}

test('Area badges count every unfinished task and subtask, including Unassigned, without filters or completion history',()=>{
 const tasks=[{areaId:'work',archived:false},{areaId:'work',archived:false,parentKey:'KAN-1'},{areaId:'work',archived:true},{areaId:'learn',archived:false},{areaId:null,archived:false},{areaId:'',archived:false},{areaId:'personal',archived:true}];
 const original=structuredClone(tasks);assert.deepEqual([...pendingAreaCounts(tasks)],[['work',2],['learn',1],['',2]]);assert.deepEqual(tasks,original);assert.equal(pendingAreaCounts(tasks).get('personal')||0,0);
});

test('Monday midnight starts a new completion week in the local timezone, including year boundaries',()=>zone('Asia/Kolkata',()=>{
 const groups=[group(1,'2026-10-25T18:29:59Z'),group(2,'2026-10-25T18:30:00Z'),group(3,'2026-01-01T09:00:00Z')];
 const weeks=completedTaskWeeks(groups);assert.deepEqual(weeks.map(week=>week.key),['2026-10-26','2026-10-19','2025-12-29']);assert.equal(weeks[0].label,'Week of 26 Oct 2026');assert.deepEqual(weeks.map(week=>week.groups[0].parent.id),[2,1,3]);
}));

test('completion weeks survive daylight saving changes and use calendar Mondays',()=>zone('America/New_York',()=>{
 const rows=[group(1,'2026-11-01T05:30:00Z'),group(2,'2026-11-01T06:30:00Z'),group(3,'2026-11-02T04:59:59Z'),group(4,'2026-11-02T05:00:00Z')];
 const weeks=completedTaskWeeks(rows);assert.deepEqual(weeks.map(week=>week.key),['2026-11-02','2026-10-26']);assert.deepEqual(weeks[1].groups.map(group=>group.parent.id),[1,2,3]);
}));

test('weekly grouping keeps subtasks with their parent and preserves the chosen order within each week',()=>zone('Asia/Kolkata',()=>{
 const rows=[group(1,'2026-10-26T09:00:00Z',{children:[task(2,'2026-10-13T08:00:00Z')]}),group(3,'2026-10-27T10:00:00Z'),group(4,'2026-10-18T10:00:00Z')];
 const before=structuredClone(rows),weeks=completedTaskWeeks(rows);assert.deepEqual(weeks[0].groups.map(group=>group.parent.id),[1,3]);assert.equal(weeks[0].groups[0].children[0].id,2);assert.deepEqual(rows,before);
}));

test('undated completions have an explicit last section instead of using an unrelated modification date',()=>zone('Asia/Kolkata',()=>{
 const rows=[group(1,null,{parent:task(1,null,{updatedAt:'2026-10-28T00:00:00Z'})}),group(2,'invalid'),group(3,'2026-10-26 01:00:00')];
 const weeks=completedTaskWeeks(rows);assert.equal(weeks[0].key,'2026-10-26');assert.equal(weeks[1].label,'Completion date unavailable');assert.deepEqual(weeks[1].groups.map(group=>group.parent.id),[1,2]);assert.deepEqual(completedTaskWeeks([]),[]);
}));

test('orphaned completed siblings are placed in their own weeks without losing or duplicating matches',()=>zone('Asia/Kolkata',()=>{
 const children=[task(1,'2026-10-26T09:00:00Z'),task(2,'2026-10-19T09:00:00Z'),task(3,null,{archived:false})];
 const rows=[{key:'parent:KAN-99',parent:null,children,matches:children.slice(0,2)}];const weeks=completedTaskWeeks(rows);
 assert.deepEqual(weeks.map(week=>week.key),['2026-10-26','2026-10-19']);assert.deepEqual(weeks.flatMap(week=>week.groups.flatMap(group=>group.matches.map(task=>task.id))),[1,2]);assert.ok(weeks.every(week=>week.groups[0].children.length===1));
}));
