import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { swapApplication, backupUserData } from './update-install.mjs';
const jobFile = process.argv[2], directory = path.dirname(jobFile);
const job = JSON.parse(await readFile(jobFile, 'utf8'));
const saveResult = async value => { const body = JSON.stringify(value); await writeFile(path.join(directory, 'result.json'), body, {mode:0o600}); await writeFile(path.join(directory, '../../last-result.json'), body, {mode:0o600}); };
const log = message => writeFile(path.join(directory, 'install.log'), `${new Date().toISOString()} ${message}\n`, { flag: 'a', mode: 0o600 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let launchedPid;
function launch() {
  if (process.platform === 'darwin') execFileSync('/usr/bin/open', [job.target]);
  else { const child = spawn(path.join(job.target, 'PersonalTaskBoard.exe'), [], { detached: true, stdio: 'ignore', windowsHide: false }); launchedPid = child.pid; child.on('error', error => { void log(error.message); }); child.unref(); }
}
async function status(port, helper = false) { try { const response = await fetch(`http://${helper ? '127.0.0.1' : 'localhost'}:${port}/api/${helper ? 'jira/status' : 'app-status'}`, { signal: AbortSignal.timeout(1000) }); return response.ok ? await response.json() : null; } catch { return null; } }
async function waitForExit() {
  for (let attempt = 0; attempt < 90; attempt++) { let alive = true; try { process.kill(job.parentPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; } if (!alive) return; await delay(1000); }
  throw new Error('The app did not close. The update was not installed.');
}
function nativeRunning() {
  if (process.platform === 'darwin') { try { return execFileSync('/bin/ps', ['-ww','-axo','comm='], {encoding:'utf8'}).split('\n').some(command => command.trim() === path.join(job.target, 'Contents/MacOS/PersonalJiraBoard')); } catch { return true; } }
  if (launchedPid) { try { process.kill(launchedPid, 0); return true; } catch { /* Check other instances as well. */ } }
  try { return Number(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', '@(Get-Process -Name PersonalTaskBoard -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:PJB_AGENT_TARGET_EXE }).Count'], {encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,PJB_AGENT_TARGET_EXE:path.join(job.target,'PersonalTaskBoard.exe')}}).trim()) !== 0; } catch { return true; }
}
let swap;
try {
  if (path.basename(directory) !== job.id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(job.id) || !Number.isInteger(job.parentPid) || job.parentPid < 1 || !path.isAbsolute(job.target)) throw new Error('Invalid update job.');
  await waitForExit();
  // Do not copy SQLite files while another instance is writing to them.
  for (let attempt = 0; attempt < 30; attempt++) {
    const checks = await Promise.all(job.servicePorts.map(async port => { try { await fetch(`http://${port === job.helperPort ? '127.0.0.1' : 'localhost'}:${port}/api/${port === job.helperPort ? 'jira/status' : 'app-status'}`, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } }));
    if (checks.every(value => !value)) break;
    if (attempt === 29) throw new Error('Another board service is still open. Close it and try the update again.');
    await delay(1000);
  }
  const browser = await status(job.browserPort);
  if (browser?.configId === job.configId) throw new Error('Close the browser development server before updating this account.');
  if (nativeRunning()) throw new Error('Another app instance is open. Close it before installing an update.');
  await backupUserData({ backupDirectory: job.backupDirectory, paths: job.backupPaths });
  if (process.platform === 'darwin') execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', job.incoming]);
  swap = await swapApplication({ platform: process.platform, target: job.target, incoming: job.incoming, jobId: job.id });
  launch();
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt++) { const [next, helper] = await Promise.all([status(job.boardPort), status(job.helperPort, true)]); if (next?.appVersion === job.version && next.configId === job.configId && next.appProtocolVersion === job.appProtocolVersion && helper?.configId === job.configId && helper.protocolVersion === job.helperProtocolVersion) { healthy = true; break; } await delay(1000); }
  if (!healthy) throw new Error('The new version did not start successfully.');
  await swap.finish().catch(error => log(`Updated, but previous files need cleanup: ${error.message}`));
  await rm(path.join(directory, 'unpacked'), {recursive:true,force:true}).catch(error => log(`Package cleanup deferred: ${error.message}`));
  await log(`Updated successfully to ${job.version}. Backup: ${job.backupDirectory}`);
  await saveResult({ ok: true, version: job.version });
} catch (error) {
  await log(error.message);
  // Never replace a running new app or its database. Keep the previous bundle for manual rollback if it has started.
  const current = await status(job.boardPort);
  const running = Boolean(current) || nativeRunning();
  if (swap && !running) { await swap.rollback(); launch(); }
  else if (!swap) { try { process.kill(job.parentPid, 0); } catch (stopped) { if (stopped.code === 'ESRCH') launch(); } }
  await saveResult({ ok: false, error: error.message, previousRetained: Boolean(swap && running) });
  process.exitCode = 1;
}
