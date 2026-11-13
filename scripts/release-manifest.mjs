import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateManifest } from '../lib/update-manifest.mjs';
const directory = path.resolve(process.argv[2] || 'outputs/releases');
const platforms = {}, builds = [];
for (const platform of ['darwin-arm64','darwin-x64','win32-x64','win32-arm64']) {
  const { version, commit, platform: actual, ...asset } = JSON.parse(await readFile(path.join(directory, `${platform}.json`),'utf8'));
  if (actual !== platform) throw new Error('Release platform mismatch.');
  builds.push({version,commit}); platforms[platform] = asset;
}
if (builds.some(build => build.version !== builds[0].version || build.commit !== builds[0].commit)) throw new Error('All release packages must come from the same commit.');
const { repository } = JSON.parse(await readFile(new URL('../config/updates.json',import.meta.url),'utf8'));
const manifest = validateManifest({ schema:1,...builds[0],platforms },repository,`v${builds[0].version}`);
await writeFile(path.join(directory,'update-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
