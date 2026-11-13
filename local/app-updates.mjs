import { readFile, writeFile, mkdir, cp, chmod, rm, open } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import updateSettings from '../config/updates.json' with { type: 'json' };
import build from '../config/build-info.json' with { type: 'json' };
import { configurationId, storageNamespace, localSettings } from '../config/settings.mjs';
import { compareVersions, releaseUrl, validateManifest, validateRepository } from '../lib/update-manifest.mjs';
import { validateArchive } from './update-archive.mjs';
import { appSupport, updateRoot, accountPath, supportRoot } from './update-paths.mjs';
const run = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const redirectHosts = new Set(['github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
export async function githubFetch(url, { fetcher = fetch, signal = AbortSignal.timeout(600000) } = {}) {
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !redirectHosts.has(parsed.hostname)) throw new Error('Untrusted update download address.');
    const response = await fetcher(parsed.href, { redirect: 'manual', signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PersonalJiraBoard-Updater' } });
    if (![301,302,303,307,308].includes(response.status)) return response;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location) throw new Error('Invalid update redirect.'); url = new URL(location, parsed).href;
  }
  throw new Error('Too many update redirects.');
}
export async function downloadVerified(response, destination, asset) {
  if (!response.ok || !response.body) throw new Error('The update could not be downloaded.');
  const handle = await open(destination, 'wx', 0o600), hash = createHash('sha256'); let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length; if (size > asset.size) throw new Error('The update package has an unexpected size.');
      hash.update(chunk); await handle.writeFile(chunk);
    }
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Update checksum verification failed. Please download it again.');
  } catch (error) { await handle.close(); await rm(destination, { force: true }); throw error; }
  await handle.close();
}
async function jsonResponse(response, max = 1000000) {
  if (!response.ok) throw new Error(`The update service returned ${response.status}. Try again later.`);
  let bytes = 0; const chunks = [];
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > max) throw new Error('The release information is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class AppUpdater {
  constructor({ fetcher = fetch, current = build, repository = updateSettings.repository, platform = process.env.PJB_UPDATE_PLATFORM || `${process.platform}-${process.arch}` } = {}) {
    this.fetcher = fetcher; this.current = current; this.repository = validateRepository(repository); this.platform = platform;
    this.candidate = null; this.preparing = false;
  }
  status() { let lastUpdate = null; try { lastUpdate = JSON.parse(readFileSync(path.join(updateRoot, 'last-result.json'), 'utf8')); } catch { /* No previous update. */ } return { lastUpdate, currentVersion: this.current.version, development: this.current.development, platform: this.platform, canInstall: Boolean(process.env.PJB_UPDATE_TARGET && process.env.PJB_NATIVE_PID), releasePage: `https://github.com/${this.repository}/releases`, candidate: this.candidate ? { version: this.candidate.version, publishedAt: this.candidate.publishedAt } : null }; }
  async check() {
    const response = await githubFetch(`https://api.github.com/repos/${this.repository}/releases/latest`, { fetcher: this.fetcher, signal: AbortSignal.timeout(20000) });
    if (response.status === 404) { this.candidate = null; return { ...this.status(), message: 'No published updates yet.' }; }
    const release = await jsonResponse(response);
    if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('The latest release is not a stable application version.');
    if (compareVersions(release.tag_name.slice(1), this.current.version) <= 0) { this.candidate = null; return { ...this.status(), message: 'You are up to date.' }; }
    const manifest = validateManifest(await jsonResponse(await githubFetch(releaseUrl(this.repository, release.tag_name, 'update-manifest.json'), { fetcher: this.fetcher, signal: AbortSignal.timeout(20000) })), this.repository, release.tag_name);
    if (!manifest.platforms[this.platform]) throw new Error('This operating system is not supported by the release.');
    this.candidate = { ...manifest, publishedAt: release.published_at };
    return this.status();
  }
  async prepare(version) {
    if (this.preparing) throw new Error('An update is already downloading.');
    if (!this.status().canInstall) throw new Error('Open the installed desktop app to install updates.');
    if (!this.candidate || this.candidate.version !== version) throw new Error('Check for updates again before downloading.');
    this.preparing = true; const id = randomUUID(), directory = path.join(updateRoot, 'jobs', id);
    try {
      const release = this.candidate, asset = release.platforms[this.platform];
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const archive = path.join(directory, 'package.zip');
      await downloadVerified(await githubFetch(asset.url, { fetcher: this.fetcher }), archive, asset);
      const packageRoot = this.platform.startsWith('darwin-') ? 'Personal Jira Board.app' : 'PersonalJiraBoard';
      await validateArchive(archive, packageRoot);
      const unpack = path.join(directory, 'unpacked'); await mkdir(unpack);
      if (process.platform === 'darwin') await run('/usr/bin/ditto', ['-x', '-k', archive, unpack]);
      else await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:PJB_ARCHIVE -DestinationPath $env:PJB_UNPACK'], { env: { ...process.env, PJB_ARCHIVE: archive, PJB_UNPACK: unpack } });
      const incoming = path.join(unpack, packageRoot);
      const resources = process.platform === 'darwin' ? path.join(incoming, 'Contents/Resources') : incoming;
      const info = JSON.parse(await readFile(path.join(resources, 'app/config/build-info.json'), 'utf8'));
      const runtime = JSON.parse(await readFile(path.join(resources, 'Runtime.json'), 'utf8'));
      if (![runtime.appProtocolVersion, runtime.helperProtocolVersion].every(value => Number.isInteger(value) && value > 0)) throw new Error('The release runtime settings are invalid.');
      if (info.version !== release.version || info.commit !== release.commit || info.development) throw new Error('The downloaded application does not match the release.');
      if (process.platform === 'darwin') await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', incoming]);
      // The agent and its Node runtime live outside the application being replaced.
      for (const file of ['update-agent.mjs', 'update-install.mjs']) await cp(path.join(root, 'desktop', file), path.join(directory, file));
      const node = path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node'); await cp(process.execPath, node); await chmod(node, 0o700);
      const backupDirectory = path.join(appSupport, 'backups', `update-${release.version}-${id}`);
      const job = { id, target: process.env.PJB_UPDATE_TARGET, parentPid: Number(process.env.PJB_NATIVE_PID), incoming, version: release.version, appProtocolVersion: runtime.appProtocolVersion, helperProtocolVersion: runtime.helperProtocolVersion, configId: configurationId, boardPort: localSettings.desktopPort, helperPort: localSettings.helperPort, browserPort: localSettings.browserPort, servicePorts: [localSettings.desktopPort, localSettings.helperPort], backupDirectory, backupPaths: { data: path.join(supportRoot, 'PersonalTaskBoard/data', storageNamespace), private: path.join(supportRoot, 'PersonalTaskBoard/private', storageNamespace), account: accountPath } };
      await writeFile(path.join(directory, 'job.json'), JSON.stringify(job), { mode: 0o600 });
      await rm(archive); return { ...this.status(), jobId: id, readyVersion: release.version };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    finally { this.preparing = false; }
  }
}
