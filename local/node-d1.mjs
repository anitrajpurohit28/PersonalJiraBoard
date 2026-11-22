import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export function databasePath(directory) {
  const native = path.join(directory, 'native', 'tasks.sqlite');
  const legacy = path.join(directory, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  // Miniflare stores Durable Object bookkeeping separately from the D1 database.
  const files = existsSync(legacy)
    ? readdirSync(legacy)
      .filter(name => name.toLowerCase().endsWith('.sqlite') && name.toLowerCase() !== 'metadata.sqlite')
      .map(name => path.join(legacy, name))
    : [];
  if (existsSync(native) && files.length || files.length > 1) throw new Error('Multiple local task databases found. Keep a backup and resolve the data path before starting.');
  return files[0] || native;
}
export function openNodeD1(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  function statement(sql, values = []) {
    function execute() {
      const prepared = db.prepare(sql);
      if (prepared.columns().length) return { success: true, results: prepared.all(...values), meta: {} };
      const result = prepared.run(...values);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    return {
      bind(...params) { return statement(sql, params); },
      async all() { return execute(); }, async run() { return execute(); },
      async first(column) { const row = execute().results[0]; return row ? (column === undefined ? row : row[column]) : null; },
      execute,
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = statements.map(query => query.execute()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
