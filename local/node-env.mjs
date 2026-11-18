import { databasePath, openNodeD1 } from './node-d1.mjs';
const key = Symbol.for('personal-jira-node-databases');
const databases = globalThis[key] ||= new Map();
export const env = { get DB() {
  const directory = process.env.PERSONAL_TASK_BOARD_NODE_DATA_DIR;
  if (!directory) throw new Error('The local database directory is not configured.');
  if (!databases.has(directory)) databases.set(directory, openNodeD1(databasePath(directory)));
  return databases.get(directory);
} };
