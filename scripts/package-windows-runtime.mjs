import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSettings, appProtocolVersion, helperProtocolVersion } from '../config/local-settings.mjs';
import { configurationFor, validateSettings } from '../lib/app-config.mjs';
import build from '../config/build-info.json' with { type: 'json' };
const root = fileURLToPath(new URL('../', import.meta.url)), target = path.resolve(process.argv[2]), app = path.join(target, 'app');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Package on Windows with x64 Node.');
// A generic local build can use the same first-launch setup as a published ZIP.
const neutralAccount = { email: 'user@example.com', jiraUrl: 'https://example.atlassian.net/jira/software/projects/KAN/boards/2' };
let accountContents;
try { accountContents = await readFile(path.join(root, 'config/app.json'), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let account = neutralAccount;
if (accountContents !== undefined) {
  try { account = validateSettings(JSON.parse(accountContents.replace(/^\uFEFF/, ''))); }
  catch { throw new Error('Check config/app.json for a valid Jira email and board URL. Remove the file if you prefer to set up Jira when the app opens.'); }
}
const releaseBuild = process.env.PJB_RELEASE_BUILD === '1';
if (releaseBuild && (account.email !== neutralAccount.email || account.jiraUrl !== neutralAccount.jiraUrl)) {
  throw new Error('Release builds must use the neutral account configuration.');
}
if (!releaseBuild && account.email !== neutralAccount.email) {
  const { prepareLocalCredentials } = await import('../local/packaging-credentials.mjs');
  await prepareLocalCredentials();
}
const { configurationId, storageNamespace } = configurationFor(account);
await rm(app, { recursive: true, force: true }); await mkdir(app, { recursive: true });
for (const directory of ['app','config','db','lib','local','public','scripts','worker','node_modules']) await cp(path.join(root,directory), path.join(app,directory), { recursive:true, dereference:true, filter: file => !['credentials.json','.DS_Store','.cache','.vite'].includes(path.basename(file)) });
await writeFile(path.join(app, 'config/app.json'), JSON.stringify(account, null, 2) + '\n');
await mkdir(path.join(app,'desktop')); for (const file of ['update-agent.mjs','update-install.mjs']) await cp(path.join(root,'desktop',file), path.join(app,'desktop',file));
await mkdir(path.join(app,'desktop/assets'),{recursive:true});
for (const file of ['PersonalTaskBoard.png','PersonalTaskBoardDark.png']) await cp(path.join(root,'desktop/assets',file),path.join(app,'desktop/assets',file));
for (const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts']) await cp(path.join(root,file),path.join(app,file));
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c','npm.cmd prune --omit=dev --ignore-scripts --no-audit --no-fund'], { cwd: app, stdio:'inherit' });
await mkdir(path.join(target,'runtime'),{recursive:true}); await cp(process.execPath,path.join(target,'runtime/node.exe'));
const logsDirectory = releaseBuild ? undefined : path.join(root, 'logs');
await writeFile(path.join(target,'Runtime.json'), JSON.stringify({ ...localSettings, configurationId, storageNamespace, appProtocolVersion, helperProtocolVersion, logsDirectory }));
await writeFile(path.join(target,'BuildID.txt'),`${build.version}-${build.commit?.slice(0,12) || 'local'}-${Date.now()}`);
