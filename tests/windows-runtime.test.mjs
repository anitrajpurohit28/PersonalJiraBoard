import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openNodeD1, databasePath } from '../local/node-d1.mjs';
import { runUpdateCommand, extractUpdateArchive } from '../local/update-process.mjs';

test('update commands drain megabytes of output without overflowing buffers and retain bounded failures', async () => {
 await runUpdateCommand(process.execPath, ['-e', "process.stderr.write('x'.repeat(3000000))"]);
 await assert.rejects(runUpdateCommand(process.execPath, ['-e', "process.stderr.write('x'.repeat(3000000)+'REAL EXTRACTION ERROR');process.exitCode=1"]), error => error.message.includes('REAL EXTRACTION ERROR') && error.message.length < 34000);
 await assert.rejects(runUpdateCommand('pjb-nonexistent-command', []), /ENOENT/);
});
test('Windows extraction uses quiet Windows 10-compatible ZIP APIs and literal environment paths', async () => {
 let call;
 await extractUpdateArchive('C:\\My files\\package.zip', 'C:\\My files\\unpack', {platform:'win32',run:async(...args)=>{call=args;}});
 assert.equal(call[0],'powershell.exe');assert.match(call[1].at(-1),/ErrorActionPreference='Stop'/);assert.match(call[1].at(-1),/ExtractToDirectory/);assert.doesNotMatch(call[1].at(-1),/Expand-Archive/);assert.equal(call[2].env.PJB_ARCHIVE,'C:\\My files\\package.zip');
 let mac;await extractUpdateArchive('/package.zip','/unpack',{platform:'darwin',run:async(...args)=>{mac=args;}});assert.equal(mac[0],'/usr/bin/ditto');
});
test('Node SQLite retains D1 query semantics, rolls back failed batches and reopens persistent data', async () => {
 const directory=mkdtempSync(path.join(tmpdir(),'pjb-node-db-'));const file=databasePath(directory);let db=openNodeD1(file);
 try {
  await db.batch([db.prepare('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE)'),db.prepare('INSERT INTO tasks VALUES (?, ?)').bind(1,'Saved task')]);
  assert.equal((await db.prepare('SELECT * FROM tasks WHERE id=?').bind(1).first()).title,'Saved task');
  assert.equal((await db.prepare('PRAGMA table_info(tasks)').all()).results.length,2);
  await assert.rejects(db.batch([db.prepare('INSERT INTO tasks VALUES (2, ?)').bind('Temporary'),db.prepare('INSERT INTO tasks VALUES (3, ?)').bind('Saved task')]));
  assert.equal(await db.prepare('SELECT * FROM tasks WHERE id=2').first(),null);
  db.close();db=openNodeD1(file);assert.equal((await db.prepare('SELECT * FROM tasks').all()).results.length,1);
 } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
test('Windows reuses the existing Miniflare SQLite database and rejects ambiguous data directories',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'pjb-db-path-'));
 try {const legacy=path.join(directory,'v3/d1/miniflare-D1DatabaseObject');mkdirSync(legacy,{recursive:true});const file=path.join(legacy,'existing.sqlite');writeFileSync(file,'');assert.equal(databasePath(directory),file);writeFileSync(path.join(legacy,'other.sqlite'),'');assert.throws(()=>databasePath(directory),/Multiple/);} finally {rmSync(directory,{recursive:true,force:true});}
});
