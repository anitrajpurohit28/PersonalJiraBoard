import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
function git(...args) { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const commit = git('rev-parse', 'HEAD'), count = git('rev-list', '--first-parent', '--count', 'HEAD');
const version = process.env.PJB_RELEASE_VERSION || (commit && count ? `${pkg.version.split('.').slice(0, 2).join('.')}.${count}` : pkg.version);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be major.minor.patch.');
const info = { version, commit: commit || null, development: process.env.PJB_RELEASE_BUILD !== '1', dirty: Boolean(git('status', '--porcelain', '--untracked-files=no')), builtAt: new Date().toISOString() };
if (!info.development && (!commit || info.dirty)) throw new Error('Official releases require a clean Git checkout.');
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'config/build-info.json');
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(info, null, 2) + '\n');
console.log(version);
