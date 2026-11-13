import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
// Windows virus scanners and WebView2 can briefly hold files after the window closes.
async function move(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(source, target); }
    catch (error) { if (process.platform !== 'win32' || !['EBUSY','EACCES','EPERM'].includes(error.code) || attempt >= 39) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
}
export async function exists(file) { return stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }); }
// Swap inside the owned Mac bundle, so updates also work without permission to create /Applications siblings.
export async function swapApplication({ platform, target, incoming, jobId }) {
  const installed = platform === 'darwin' ? path.join(target, 'Contents') : target;
  const source = platform === 'darwin' ? path.join(incoming, 'Contents') : incoming;
  const next = platform === 'darwin' ? path.join(target, `.next-${jobId}`) : `${target}.next-${jobId}`;
  const previous = platform === 'darwin' ? path.join(target, `.previous-${jobId}`) : `${target}.previous-${jobId}`;
  if (!await exists(installed)) throw new Error('The installed application could not be found.');
  await cp(source, next, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  await move(installed, previous);
  try { await move(next, installed); } catch (error) { await move(previous, installed); throw error; }
  return {
    async rollback() { const failed = `${next}.failed`; await move(installed, failed); try { await move(previous, installed); } catch (error) { await move(failed, installed); throw error; } await rm(failed, { recursive: true, force: true }); },
    async finish() { await rm(previous, { recursive: true, force: true }); },
  };
}
export async function backupUserData({ backupDirectory, paths }) {
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  for (const [name, source] of Object.entries(paths)) if (await exists(source)) await cp(source, path.join(backupDirectory, name), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
}
