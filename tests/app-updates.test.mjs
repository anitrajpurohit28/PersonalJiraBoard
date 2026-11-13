import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink, readlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compareVersions, releaseUrl, validateManifest } from '../lib/update-manifest.mjs';
import { validateSettings, configurationFor } from '../lib/app-config.mjs';
import { settings, configurationId, storageNamespace } from '../config/settings.mjs';
import { AppUpdater, githubFetch, downloadVerified } from '../local/app-updates.mjs';
import { validateArchive } from '../local/update-archive.mjs';
import { swapApplication, backupUserData, exists } from '../desktop/update-install.mjs';
import { createJiraHelperServer } from '../local/jira-server.mjs';
const repository = 'anitrajpurohit28/PersonalJiraBoard';
function manifest(version = '1.0.9') { return { schema: 1, version, commit:'a'.repeat(40), platforms: Object.fromEntries(['darwin-arm64','darwin-x64','win32-x64','win32-arm64'].map(platform => {
  const name = `PersonalJiraBoard-${version}-${platform}.zip`;
  return [platform, {name,sha256:'b'.repeat(64),size:100,url:releaseUrl(repository,`v${version}`,name)}];
})) }; }
async function scratch(fn) { const directory = await mkdtemp(path.join(tmpdir(),'pjb-updates-')); try { await fn(directory); } finally { await rm(directory,{recursive:true,force:true}); } }

test('update versions compare numerically, not lexically; invalid versions are rejected', () => {
  for (const [a,b,expected] of [['1.0.10','1.0.9',1],['2.0.0','1.99.99',1],['1.0.8','1.0.9',-1],['1.0.9','1.0.9',0]]) assert.equal(compareVersions(a,b),expected);
  for (const value of ['v1.0.2','1.2','1.2.3-beta','../1.2.3',null]) assert.throws(() => compareVersions(value,'1.0.0'));
});
test('external account settings retain the exact data namespace and reject token fields', () => {
  assert.deepEqual(configurationFor(validateSettings(settings)),{configurationId,storageNamespace});
  assert.notEqual(configurationFor(validateSettings({...settings,email:'other@example.com'})).configurationId,configurationId);
  assert.throws(() => validateSettings({...settings,apiToken:'secret'}));
});
test('release manifests require all four platforms and pin downloads to the configured repository and tag', () => {
  const good = manifest(); assert.deepEqual(validateManifest(good,repository,'v1.0.9'),good);
  for (const change of [m => m.schema=2,m => m.version='9.9.9',m => m.commit='bad',m => delete m.platforms['win32-arm64'],m => m.platforms['darwin-arm64'].url='https://evil.example/app.zip',m => m.platforms['darwin-arm64'].size=-1,m => m.platforms['darwin-arm64'].sha256='bad',m => m.platforms['darwin-arm64'].name='../payload.zip']) { const bad = structuredClone(good);change(bad);assert.throws(() => validateManifest(bad,repository,'v1.0.9')); }
});
test('the release check handles first release, offline, same/older versions, and newer versions', async () => {
  const current = {version:'1.0.8',development:true};
  const empty = new AppUpdater({current,fetcher:async () => new Response(null,{status:404})});
  assert.equal((await empty.check()).message,'No published updates yet.');
  const offline = new AppUpdater({current,fetcher:async () => {throw new Error('offline');}});
  await assert.rejects(() => offline.check(),/offline/);
  for (const version of ['1.0.7','1.0.8']) {
    let calls = 0;
    const updater = new AppUpdater({current,fetcher:async () => {calls++;return Response.json({tag_name:`v${version}`});}});
    assert.equal((await updater.check()).message,'You are up to date.');assert.equal(calls,1);
  }
  const newer = new AppUpdater({current,platform:'darwin-arm64',fetcher:async url => url.includes('api.github.com') ? Response.json({tag_name:'v1.0.9',published_at:'2026-11-12T10:00:00Z'}) : Response.json(manifest())});
  assert.equal((await newer.check()).candidate.version,'1.0.9');
  assert.equal(JSON.stringify(newer.status()).includes('sha256'),false);
  await assert.rejects(() => newer.prepare('1.0.10'));
});
test('download redirects cannot leave GitHub HTTPS asset hosts', async () => {
  for (const location of ['http://github.com/app','https://evil.example/app','https://github.com.evil.example/app','https://user:secret@github.com/app','https://127.0.0.1/app']) {
    let calls = 0;await assert.rejects(() => githubFetch('https://github.com/release',{fetcher:async () => {calls++;return new Response(null,{status:302,headers:{location}});}}),/Untrusted/);assert.equal(calls,1);
  }
  let calls = 0;
  const response = await githubFetch('https://github.com/release',{fetcher:async url => {calls++;return url.includes('release-assets') ? new Response('ok') : new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/asset'}});}});
  assert.equal(await response.text(),'ok');assert.equal(calls,2);
});
test('downloads check both length and SHA-256 and remove incomplete packages', async () => scratch(async directory => {
  const body = Buffer.from('verified package'), asset = {size:body.length,sha256:createHash('sha256').update(body).digest('hex')};
  const good = path.join(directory,'good.zip');await downloadVerified(new Response(body),good,asset);assert.deepEqual(await readFile(good),body);
  for (const [name,payload,descriptor] of [['corrupt','wrong contents',asset],['truncated',body.subarray(0,3),asset],['hash',body,{...asset,sha256:'0'.repeat(64)}]]) {
    const file = path.join(directory,name);await assert.rejects(() => downloadVerified(new Response(payload),file,descriptor));assert.equal(await exists(file),false);
  }
}));
test('archives reject traversal, unrelated roots, header disagreement, and escaping symlinks before extraction', async () => scratch(async directory => {
  const source = path.join(directory,'source');await mkdir(source);await writeFile(path.join(source,'file.txt'),'safe');
  const archive = path.join(directory,'valid.zip');
  execFileSync(process.platform === 'win32' ? 'python' : 'python3',['scripts/zip-release.py',source,archive,'PersonalJiraBoard']);
  await validateArchive(archive,'PersonalJiraBoard');
  await assert.rejects(() => validateArchive(archive,'DifferentRoot'),/Unsafe/);
  const raw = await readFile(archive);const changed = Buffer.from(raw);changed[30] ^= 1;await writeFile(path.join(directory,'bad.zip'),changed);
  await assert.rejects(() => validateArchive(path.join(directory,'bad.zip'),'PersonalJiraBoard'),/disagree/);
  for (const [name,entry,target] of [['traversal','PersonalJiraBoard/../outside',''],['absolute','/PersonalJiraBoard/file',''],['symlink','PersonalJiraBoard/link','../../outside']]) {
    const file = path.join(directory,name+'.zip');
    execFileSync(process.platform === 'win32' ? 'python' : 'python3',['-c',`import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); i=zipfile.ZipInfo(sys.argv[2]); i.create_system=3; i.external_attr=(0o120777 if sys.argv[3] else 0o100644)<<16; z.writestr(i,sys.argv[3] or 'data'); z.close()`,file,entry,target]);
    await assert.rejects(() => validateArchive(file,'PersonalJiraBoard'));
  }
}));
test('Windows and macOS swaps preserve separate user data and can restore the previous application', async () => scratch(async directory => {
  for (const platform of ['win32','darwin']) {
    const target = path.join(directory,platform,'installed'),incoming=path.join(directory,platform,'incoming');
    const inner = platform==='darwin' ? 'Contents' : '';
    await mkdir(path.join(target,inner),{recursive:true});await mkdir(path.join(incoming,inner),{recursive:true});
    await writeFile(path.join(target,inner,'version'),'old');await writeFile(path.join(incoming,inner,'version'),'new');
    const data = path.join(directory,'data');await mkdir(data,{recursive:true});await writeFile(path.join(data,'queue.json'),'unsynced');
    const swap=await swapApplication({platform,target,incoming,jobId:'one'});assert.equal(await readFile(path.join(target,inner,'version'),'utf8'),'new');
    await swap.rollback();assert.equal(await readFile(path.join(target,inner,'version'),'utf8'),'old');assert.equal(await readFile(path.join(data,'queue.json'),'utf8'),'unsynced');
    const next=await swapApplication({platform,target,incoming,jobId:'two'});await next.finish();assert.equal(await readFile(path.join(target,inner,'version'),'utf8'),'new');
    assert.equal(await exists(platform==='darwin' ? path.join(target,'.previous-two') : target+'.previous-two'),false);
    await assert.rejects(() => swapApplication({platform,target,incoming:path.join(directory,'missing'),jobId:'three'}));assert.equal(await readFile(path.join(target,inner,'version'),'utf8'),'new');
  }
}));
test('pre-update backups retain SQLite WAL, offline queue, attachments and credentials without modifying originals', async () => scratch(async directory => {
  const data=path.join(directory,'data'),privateDir=path.join(directory,'private');await mkdir(data);await mkdir(path.join(privateDir,'attachments'),{recursive:true});
  await writeFile(path.join(data,'tasks.sqlite'),'db');await writeFile(path.join(data,'tasks.sqlite-wal'),'wal');await writeFile(path.join(privateDir,'queue.json'),'queued');await writeFile(path.join(privateDir,'credentials.json'),'private');await writeFile(path.join(privateDir,'attachments','draft.txt'),'draft');
  const backup=path.join(directory,'backup');await backupUserData({backupDirectory:backup,paths:{data,private:privateDir,missing:path.join(directory,'missing')}});
  for (const file of ['data/tasks.sqlite','data/tasks.sqlite-wal','private/queue.json','private/credentials.json','private/attachments/draft.txt']) assert.equal(await readFile(path.join(backup,file),'utf8'),await readFile(path.join(directory,file),'utf8'));
  if(process.platform!=='win32') assert.equal((await stat(backup)).mode&0o777,0o700);
}));
test('helper exposes update checks without contacting Jira and rejects foreign-origin update commands', async () => {
  let calls=0;
  const server=createJiraHelperServer({publicStatus:()=>({configId:configurationId,protocolVersion:24,message:'Jira connected'})},{status:()=>({currentVersion:'1.0.8'}),check:async()=>{calls++;return {message:'up to date'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(base+'/api/jira/app-update-status')).json()).currentVersion,'1.0.8');
    assert.equal((await fetch(base+'/api/jira/app-update-check',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/jira/app-update-check',{method:'POST',headers:{Origin:'http://localhost:9999','Content-Type':'application/json'},body:'{}'})).status,403);
    const result=await fetch(base+'/api/jira/app-update-check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(result.status,200);assert.equal((await result.json()).message,'up to date');assert.equal(calls,1);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('application swaps preserve relative symlinks required by the macOS code signature', async () => scratch(async directory => {
  if(process.platform==='win32') return;
  const target=path.join(directory,'installed'), incoming=path.join(directory,'incoming');
  await mkdir(path.join(target,'Contents'),{recursive:true});await mkdir(path.join(incoming,'Contents','.bin'),{recursive:true});
  await writeFile(path.join(incoming,'Contents','cli.mjs'),'runtime');await symlink('../cli.mjs',path.join(incoming,'Contents','.bin','tool'));
  const swap=await swapApplication({platform:'darwin',target,incoming,jobId:'symlink'});
  assert.equal(await readlink(path.join(target,'Contents','.bin','tool')),'../cli.mjs');await swap.finish();
}));

test('release tooling packages all four platforms, combines one immutable commit, and rejects personal build configuration', async () => scratch(async directory => {
  for (const file of ['scripts/package-release.mjs','scripts/zip-release.py','scripts/release-manifest.mjs','lib/update-manifest.mjs','local/update-archive.mjs']) {
    const target=path.join(directory,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(new URL('../'+file,import.meta.url)));
  }
  const version='1.0.123',commit='a'.repeat(40),build={version,commit,development:false,dirty:false};
  await mkdir(path.join(directory,'config'));await writeFile(path.join(directory,'config/build-info.json'),JSON.stringify(build));await writeFile(path.join(directory,'config/app.json'),JSON.stringify({email:'user@example.com',jiraUrl:'https://example.atlassian.net/jira/software/projects/KAN/boards/2'}));await writeFile(path.join(directory,'config/updates.json'),JSON.stringify({repository}));
  for (const platform of ['darwin-arm64','darwin-x64','win32-x64','win32-arm64']) {
    const source=platform.startsWith('darwin-') ? 'outputs/Personal Jira Board.app/Contents/Resources' : 'outputs/windows/'+platform.replace('win32-','win-');
    const config=path.join(directory,source,'app/config');await mkdir(config,{recursive:true});await writeFile(path.join(config,'build-info.json'),JSON.stringify(build));
    execFileSync(process.execPath,['scripts/package-release.mjs',platform],{cwd:directory});
  }
  execFileSync(process.execPath,['scripts/release-manifest.mjs'],{cwd:directory});
  const value=JSON.parse(await readFile(path.join(directory,'outputs/releases/update-manifest.json'),'utf8'));assert.equal(value.version,version);assert.equal(Object.keys(value.platforms).length,4);
  for(const asset of Object.values(value.platforms)){const bytes=await readFile(path.join(directory,'outputs/releases',asset.name));assert.equal(asset.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(asset.size,bytes.length);}
  await writeFile(path.join(directory,'config/app.json'),JSON.stringify({email:'private@example.com'}));
  assert.throws(()=>execFileSync(process.execPath,['scripts/package-release.mjs','darwin-arm64'],{cwd:directory,stdio:'pipe'}),/Command failed/);
  const descriptor=path.join(directory,'outputs/releases/win32-arm64.json'),different=JSON.parse(await readFile(descriptor,'utf8'));different.commit='f'.repeat(40);await writeFile(descriptor,JSON.stringify(different));
  assert.throws(()=>execFileSync(process.execPath,['scripts/release-manifest.mjs'],{cwd:directory,stdio:'pipe'}),/Command failed/);
}));
