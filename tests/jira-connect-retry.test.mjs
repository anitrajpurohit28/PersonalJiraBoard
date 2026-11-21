import test from 'node:test';
import assert from 'node:assert/strict';
import { JiraConnection } from '../local/jira-connection.mjs';
import { jiraFixture } from './jira-fixture.mjs';

test('failed reconnect keeps cached tasks and exposes a useful connection error without credentials', async () => {
 const fixture=jiraFixture();const broker=new JiraConnection({workspace:fixture.makeWorkspace(),autoSync:false,loadToken:async()=>null,createClient:fixture.makeClient});
 await broker.connect({apiToken:'fixture-secret'});fixture.state.offline=true;
 const status=await broker.connect({apiToken:'fixture-secret'});
 assert.equal(status.connected,false);assert.equal(status.availableOffline,true);assert.ok(status.connectionError);assert.equal(JSON.stringify(status).includes('fixture-secret'),false);
 fixture.state.offline=false;await broker.connect();assert.equal(broker.publicStatus().connected,true);assert.equal(broker.publicStatus().connectionError,null);
});
test('session-only token survives automatic reconnect but is forgotten on explicit disconnect', async()=>{
 const fixture=jiraFixture(),tokens=[];const broker=new JiraConnection({workspace:fixture.makeWorkspace(),autoSync:false,loadToken:async()=>null,saveToken:()=>assert.fail('session token saved to disk'),createClient:token=>{tokens.push(token);return fixture.makeClient(token);}});
 await broker.connect({apiToken:'session-fixture',remember:false});fixture.state.offline=true;await broker.tick();fixture.state.offline=false;await broker.tick();
 assert.equal(broker.publicStatus().connected,true);assert.deepEqual(tokens,['session-fixture','session-fixture']);
 broker.disconnect();assert.equal(broker.publicStatus().hasCredential,false);await broker.connect();assert.equal(broker.publicStatus().connected,false);
});
test('a pasted replacement token is used after an in-flight startup attempt finishes',async()=>{
 const fixture=jiraFixture(),tokens=[];let unblock;const blocked=new Promise(resolve=>{unblock=resolve;});
 const broker=new JiraConnection({workspace:fixture.makeWorkspace(),autoSync:false,loadToken:async()=>({token:'old-fixture',source:'saved'}),createClient:token=>{tokens.push(token);const client=fixture.makeClient(token);if(token==='old-fixture')client.initialise=async()=>{await blocked;throw Object.assign(Error('Old token rejected'),{status:401});};return client;}});
 const first=broker.connect();await new Promise(resolve=>setImmediate(resolve));const replacement=broker.connect({apiToken:'new-fixture'});unblock();await assert.rejects(first,/Old token/);await replacement;
 assert.deepEqual(tokens,['old-fixture','new-fixture']);assert.equal(broker.publicStatus().connected,true);
});
