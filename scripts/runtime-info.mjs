import { readFile } from 'node:fs/promises';
import { validateSettings, configurationFor } from '../lib/app-config.mjs';
const [accountPath, runtimePath] = process.argv.slice(2);
const account = validateSettings(JSON.parse(await readFile(accountPath, 'utf8')));
const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
console.log(JSON.stringify({ ...runtime, ...configurationFor(account) }));
