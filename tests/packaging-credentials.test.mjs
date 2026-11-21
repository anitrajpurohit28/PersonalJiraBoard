import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCredentialToken } from '../local/jira-credentials.mjs';
import { prepareLocalCredentials } from '../local/packaging-credentials.mjs';

test('credentials accept standard and Windows BOM JSON without changing token validation', () => {
 for (const prefix of ['', '\uFEFF']) assert.equal(parseCredentialToken(prefix + '{"apiToken":"fixture-only-token"}'), 'fixture-only-token');
 assert.equal(parseCredentialToken('{}'), null);
 assert.throws(() => parseCredentialToken('{invalid', 'config/credentials.json'), /config\/credentials.json.*valid JSON/);
 assert.throws(() => parseCredentialToken('{"apiToken":"token with spaces"}'), /valid Jira API token/);
});
test('local packaging still migrates valid credentials without putting them in output', async () => {
 const saved=[];
 await prepareLocalCredentials({releaseBuild:false,load:async()=>({token:'fixture-only-token'}),save:async token=>saved.push(token),warn:()=>assert.fail('unexpected warning')});
 assert.deepEqual(saved,['fixture-only-token']);
});
test('malformed or unwritable credentials cannot abort packaging or leak secrets', async () => {
 for (const fail of ['load','save']) {
  const warnings=[];
  await prepareLocalCredentials({releaseBuild:false,load:async()=>{if(fail==='load')throw Error('SECRET');return {token:'SECRET'};},save:async()=>{throw Error('SECRET');},warn:message=>warnings.push(message)});
  assert.equal(warnings.length,1);assert.match(warnings[0],/Packaging will continue/);assert.equal(warnings[0].includes('SECRET'),false);
 }
});
test('release packaging never reads or writes local credentials; missing token needs no migration', async () => {
 await prepareLocalCredentials({releaseBuild:true,load:()=>assert.fail('release read credentials'),save:()=>assert.fail('release wrote credentials')});
 await prepareLocalCredentials({releaseBuild:false,load:async()=>null,save:()=>assert.fail('missing token was saved'),warn:()=>assert.fail('unexpected warning')});
});
