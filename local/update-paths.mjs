import { homedir } from 'node:os';
import path from 'node:path';
export const supportRoot = process.platform === 'darwin' ? path.join(homedir(), 'Library/Application Support') : process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(homedir(), 'AppData/Local') : process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share');
export const appSupport = path.join(supportRoot, 'PersonalJiraBoard');
export const updateRoot = path.join(appSupport, 'updates');
export const accountPath = path.join(appSupport, 'account.json');
