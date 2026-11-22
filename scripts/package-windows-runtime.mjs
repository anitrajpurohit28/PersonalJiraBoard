import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSettings, appProtocolVersion, helperProtocolVersion } from '../config/local-settings.mjs';
import { configurationFor, validateSettings } from '../lib/app-config.mjs';
import build from '../config/build-info.json' with { type: 'json' };
const root = fileURLToPath(new URL('../', import.meta.url)), target = path.resolve(process.argv[2]), app = path.join(target, 'app');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Package on Windows with x64 Node.');
// Portable builds use first-launch setup unless the builder explicitly opts in.
const neutralAccount = { email: 'user@example.com', jiraUrl: 'https://example.atlassian.net/jira/software/projects/KAN/boards/2' };
const releaseBuild = process.env.PJB_RELEASE_BUILD === '1';
const useLocalAccount = process.argv.includes('--use-local-account');
if (releaseBuild && useLocalAccount) throw new Error('Release builds must use the neutral account configuration.');

const sourceAccount = path.join(root, 'config/app.json');
let account = neutralAccount;
if (useLocalAccount) {
  try { account = validateSettings(JSON.parse((await readFile(sourceAccount, 'utf8')).replace(/^\uFEFF/, ''))); }
  catch { throw new Error('Check config/app.json for a valid Jira email and board URL before using -UseLocalAccount.'); }
  const { prepareLocalCredentials } = await import('../local/packaging-credentials.mjs');
  await prepareLocalCredentials();
}
const { configurationId, storageNamespace } = configurationFor(account);
await rm(app, { recursive: true, force: true }); await mkdir(app, { recursive: true });
for (const directory of ['app','config','db','lib','local','public','scripts','worker','node_modules']) await cp(path.join(root,directory), path.join(app,directory), { recursive:true, dereference:true, filter: file => path.resolve(file) !== sourceAccount && !['credentials.json','.DS_Store','.cache','.vite'].includes(path.basename(file)) });
await writeFile(path.join(app, 'config/app.json'), JSON.stringify(account, null, 2) + '\n');
await mkdir(path.join(app,'desktop')); for (const file of ['update-agent.mjs','update-install.mjs']) await cp(path.join(root,'desktop',file), path.join(app,'desktop',file));
for (const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts']) await cp(path.join(root,file),path.join(app,file));
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c','npm.cmd prune --omit=dev --ignore-scripts --no-audit --no-fund'], { cwd: app, stdio:'inherit' });
await mkdir(path.join(target,'runtime'),{recursive:true}); await cp(process.execPath,path.join(target,'runtime/node.exe'));
const logsDirectory = releaseBuild ? undefined : path.join(root, 'logs');
await writeFile(path.join(target,'Runtime.json'), JSON.stringify({ ...localSettings, configurationId, storageNamespace, appProtocolVersion, helperProtocolVersion, logsDirectory }));
await writeFile(path.join(target,'BuildID.txt'),`${build.version}-${build.commit?.slice(0,12) || 'local'}-${Date.now()}`);
