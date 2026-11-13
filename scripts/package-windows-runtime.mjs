import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSettings, configurationId, storageNamespace, appProtocolVersion, helperProtocolVersion } from '../config/settings.mjs';
import { loadApiToken, saveApiToken } from '../local/jira-credentials.mjs';
import build from '../config/build-info.json' with { type: 'json' };
const root = fileURLToPath(new URL('../', import.meta.url)), target = path.resolve(process.argv[2]), app = path.join(target, 'app');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Package on Windows with x64 Node.');
if (process.env.PJB_RELEASE_BUILD !== '1') { const credential = await loadApiToken(); if (credential) await saveApiToken(credential.token); }
await rm(app, { recursive: true, force: true }); await mkdir(app, { recursive: true });
for (const directory of ['app','config','db','lib','local','public','scripts','worker','node_modules']) await cp(path.join(root,directory), path.join(app,directory), { recursive:true, dereference:true, filter: file => !['credentials.json','.DS_Store','.cache','.vite'].includes(path.basename(file)) });
await mkdir(path.join(app,'desktop')); for (const file of ['update-agent.mjs','update-install.mjs']) await cp(path.join(root,'desktop',file), path.join(app,'desktop',file));
for (const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts']) await cp(path.join(root,file),path.join(app,file));
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c','npm.cmd prune --omit=dev --ignore-scripts --no-audit --no-fund'], { cwd: app, stdio:'inherit' });
await mkdir(path.join(target,'runtime'),{recursive:true}); await cp(process.execPath,path.join(target,'runtime/node.exe'));
await writeFile(path.join(target,'Runtime.json'), JSON.stringify({ ...localSettings,configurationId,storageNamespace,appProtocolVersion,helperProtocolVersion }));
await writeFile(path.join(target,'BuildID.txt'),`${build.version}-${build.commit?.slice(0,12) || 'local'}-${Date.now()}`);
// No API token or user data is ever copied to the distributable.
const config = JSON.parse(await readFile(path.join(app,'config/app.json'),'utf8'));
if (process.env.PJB_RELEASE_BUILD === '1' && config.email !== 'user@example.com') throw new Error('Release builds must use the neutral account configuration.');
