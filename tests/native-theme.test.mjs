import test from 'node:test';
import assert from 'node:assert/strict';
import { syncThemeIcon } from '../app/personal-dashboard/native-theme.ts';

function host(run, native = {}) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const icon = { href: '', setAttribute(key, value) { this[key] = value; } };
  globalThis.window = native;
  globalThis.document = { querySelector: () => icon };
  try { run(icon); } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
}
test('macOS receives the selected theme in both directions and favicon follows', () => {
  const calls = [];
  host(icon => {
    syncThemeIcon('dark'); assert.equal(icon.href, '/favicon-dark.png');
    syncThemeIcon('light'); assert.equal(icon.href, '/favicon.png');
    assert.deepEqual(calls, ['dark', 'light']);
  }, { webkit: { messageHandlers: { taskTheme: { postMessage: theme => calls.push(theme) } } } });
});
test('Windows receives the same theme selection using WebView2', () => {
  const calls = [];
  host(() => { syncThemeIcon('dark'); syncThemeIcon('light'); }, { chrome: { webview: { postMessage: body => calls.push(body) } } });
  assert.deepEqual(calls, [{ type: 'task-theme', theme: 'dark' }, { type: 'task-theme', theme: 'light' }]);
});
test('browser and older native hosts can switch theme without a bridge', () => {
  host(icon => { syncThemeIcon('dark'); assert.equal(icon.href, '/favicon-dark.png'); syncThemeIcon('light'); assert.equal(icon.href, '/favicon.png'); });
  host(icon => { assert.doesNotThrow(() => syncThemeIcon('dark')); assert.equal(icon.href, '/favicon-dark.png'); }, { webkit: { messageHandlers: { taskTheme: { postMessage() { throw Error('unavailable'); } } } } });
});
test('server rendering and unknown themes never send a native message', () => {
  assert.doesNotThrow(() => syncThemeIcon('dark'));
  host(icon => { syncThemeIcon('invalid'); assert.equal(icon.href, ''); }, { chrome: { webview: { postMessage() { assert.fail('invalid theme sent'); } } } });
});
