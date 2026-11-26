// Synthetic accounts and an in-memory backend only; never writes real cloud data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('@playwright/test');
let base = process.argv[2];
let server;
const namespace = 'thinkcloze_sat_context_v1';
const userA = {id:'test-account-a',email:'account-a@invalid.test'};
const userB = {id:'test-account-b',email:'account-b@invalid.test'};
const clone = value => value == null ? value : structuredClone(value);
const delay = ms => new Promise(r=>setTimeout(r,ms));
const rows = new Map();
const calls=[];
let clock = 0;
let gate=null;
let errors=[];
const stamp = () => new Date(Date.UTC(2026,10,26,0,0,0,++clock)).toISOString();
const rowKey = row => JSON.stringify([row.user_id,row.progress_id]);
function match(row,filters){return filters.every(([key,value,op])=>op==='in'?value.includes(row[key]):row[key]===value);}
const resultFor = (data,shape) => ({data: shape === 'single' || shape === 'maybeSingle' ? data[0] || null : data,error:null});
async function backend(query){
  calls.push(clone(query));
  if(query.offline) return {data:null,error:{message:'Network unavailable (test)',code:'NETWORK'},status:0};
  if(!query.user) return {data:null,error:{message:'Authentication required (test RLS)',code:'42501'},status:403};
  const owned=[...rows.values()].filter(row=>row.user_id===query.user && match(row,query.filters));
  if(query.op==='select'){
    const result=resultFor(clone(owned),query.shape);
    if(gate && gate.kind==='select' && (!gate.device || gate.device===query.device) && (!gate.user || gate.user===query.user)){
      const currentGate=gate;
      return new Promise(resolve=>{currentGate.waiters.push(()=>resolve(result));if(currentGate.waiters.length>=currentGate.count){gate=null;currentGate.release();}});
    }
    return result;
  }
  if(query.op==='insert' || query.op==='upsert'){
    const input=Array.isArray(query.payload)?query.payload:[query.payload];const saved=[];
    for(const item of input){
      if(item.user_id!==query.user)return {data:null,error:{message:'Wrong account (test RLS)',code:'42501'},status:403};
      if(rows.has(rowKey(item)) && query.op==='insert')return {data:null,error:{message:'duplicate key (test)',code:'23505'},status:409};
      const row={...clone(item),created_at:stamp(),updated_at:stamp()};rows.set(rowKey(row),row);saved.push(row);
    }
    return resultFor(clone(saved),query.shape);
  }
  if(query.op==='update'){
    const saved=owned.map(row=>{const next={...row,...clone(query.payload),updated_at:stamp()};rows.set(rowKey(next),next);return next;});
    if(!saved.length) query.conflict=true;
    return resultFor(clone(saved),query.shape);
  }
  throw new Error('Unsupported test operation '+query.op);
}
function makeGate({count=1,device=null,user=null}={}){
 const waiters=[];let release;
 const released=new Promise(r=>release=r);
 const created={kind:'select',count,device,user,waiters,release(){for(const r of waiters)r();release();}};
 gate=created;return {...created,released,forceRelease(){if(gate===created)gate=null;created.release();}};
}
async function waitFor(fn,message,ms=8000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(30);}throw new Error('Timed out: '+message);}
async function main(){
 if(!base){
  const root=path.resolve(__dirname,'..');
  server=http.createServer((request,response)=>{
   const relative=decodeURIComponent(new URL(request.url,'http://local').pathname).slice(1);
   if(!['sat-context/progress-state.js','sat-context/account-sync.js'].includes(relative)){response.writeHead(404).end();return}
   response.writeHead(200,{'Content-Type':'application/javascript'});
   response.end(fs.readFileSync(path.join(root,relative)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
 }
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const contexts=[];
 async function device(id,user=null,legacy=null,scope=namespace,sharedContext=null){
  const context=sharedContext||await browser.newContext();if(!sharedContext)contexts.push(context);const page=await context.newPage();
  page.on('pageerror',err=>errors.push(id+': '+err.message));
  await page.exposeBinding('__satBackend',(_source,query)=>backend({...query,device:id}));
  await page.route('**/__sat_sync_test__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body><script src="/sat-context/progress-state.js"></script><script src="/sat-context/account-sync.js"></script></body>'}));
  await page.addInitScript(({initialUser,legacy,namespace})=>{
   if(legacy)localStorage.setItem(namespace,JSON.stringify(legacy));
   window.__fakeUser=localStorage.getItem('__sat_test_auth') ? JSON.parse(localStorage.getItem('__sat_test_auth')) : initialUser;window.__offline=localStorage.getItem('__sat_test_offline')==='true';window.__authListeners=[];
   function builder(table){
    const q={table,op:'select',filters:[],shape:'array'};
    const api={select(){return api},eq(k,v){q.filters.push([k,v,'eq']);return api},in(k,v){q.filters.push([k,v,'in']);return api},insert(payload){q.op='insert';q.payload=payload;return api},upsert(payload){q.op='upsert';q.payload=payload;return api},update(payload){q.op='update';q.payload=payload;return api},maybeSingle(){q.shape='maybeSingle';return api},single(){q.shape='single';return api},limit(){return api},order(){return api},then(resolve,reject){return window.__satBackend({...q,user:window.__fakeUser?.id,offline:window.__offline}).then(resolve,reject)}};
    return api;
   }
   const auth={
    async getSession(){return {data:{session:window.__fakeUser?{user:window.__fakeUser}:null},error:null}},
    async getUser(){return {data:{user:window.__fakeUser},error:null}},
    onAuthStateChange(cb){window.__authListeners.push(cb);return {data:{subscription:{unsubscribe(){window.__authListeners=window.__authListeners.filter(x=>x!==cb)}}}}},
    async signOut(){await window.__setUser(null);return {error:null}},
    async signInWithPassword(){return {data:{user:window.__fakeUser,session:{user:window.__fakeUser}},error:null}},
   };
   window.__setUser=async user=>{window.__fakeUser=user;try{localStorage.setItem('__sat_test_auth',JSON.stringify(user))}catch{};for(const cb of window.__authListeners)await cb(user?'SIGNED_IN':'SIGNED_OUT',user?{user}:null)};
   window.fakeClient={auth,from:builder};window.__views=[];window.__statuses=[];
  },{initialUser:user,legacy,namespace:scope});
  await page.goto(base+'/__sat_sync_test__',{waitUntil:'domcontentloaded'});
  const initialize=async()=>page.evaluate(async namespace=>{
   window.sync=new SATQuestionSync({namespace,model:SATProgress,client:fakeClient,ui:false,pollMs:3600000,debounceMs:3600000,onChange:view=>{window.__lastView=view;window.__views.push(JSON.parse(JSON.stringify(view)))},onStatus:status=>window.__statuses.push(status)});
   await sync.init();
  },scope);
  await initialize();
  return {id,page,context,async reload(){await page.reload({waitUntil:'domcontentloaded'});await initialize()},async load(){return page.evaluate(()=>sync.load())},async flush(){await page.evaluate(()=>sync.syncNow())},async login(user){await page.evaluate(async user=>{await window.__setUser(user);await new Promise(resolve=>setTimeout(resolve,20))},user)},async offline(value){await page.evaluate(value=>{window.__offline=value;localStorage.setItem('__sat_test_offline',String(value));window.dispatchEvent(new Event(value?'offline':'online'))},value)},async change(fn,options){return page.evaluate(async({code,options})=>{await sync.change((0,eval)('('+code+')'),options)}, {code:fn.toString(),options})}};
 }
 const legacy={progress:{Q0001:{attempts:2,wrong:true,streak:0,review:true}},favorites:{Q0001:true},words:{'["legacy","old meaning"]':{id:'Q0001',letter:'A'}},rounds:{'set-1':{ids:['Q0001','Q0002','Q0003'],answers:{Q0001:'D'},index:1,done:false}}};
 try{
  const one=await device('one',null,legacy);
  const imported=await one.load();
  for(const [key,value] of Object.entries(legacy.progress.Q0001))assert.equal(imported.progress.Q0001[key],value,'legacy progress '+key);
  assert.deepEqual(imported.favorites,legacy.favorites);assert.deepEqual(imported.words,legacy.words);
  for(const [key,value] of Object.entries(legacy.rounds['set-1']))assert.deepEqual(imported.rounds['set-1'][key],value,'legacy round '+key);
  await one.change(state=>{state.favorites.Q0002=true;});
  assert.equal(calls.filter(q=>q.op!=='select').length,0,'guest does not write cloud');
  await one.login(userA);await one.flush();
  await waitFor(()=>rows.size===1,'first account migration cloud write');
  assert.equal((await one.load()).progress.Q0001.attempts,2);
  const two=await device('two',userA);await two.flush();
  assert.deepEqual(await two.load(),await one.load(),'second device restores cloud');
  for(let i=0;i<3;i++){await one.flush();await two.flush();}
  assert.equal((await two.load()).progress.Q0001.attempts,2,'migration not recounted after resync');
  await one.offline(true);await one.reload();
  assert.equal((await one.load()).progress.Q0001.attempts,2,'account document restores while cloud is unavailable');
  assert((await one.load()).favorites.Q0002,'account document retains local favorite');
  await one.offline(false);await one.flush();
  console.log('PASS guest/local migration -> account document -> cloud -> second device; offline reload');

  await two.offline(true);
  await one.change(state=>{delete state.favorites.Q0001;delete state.words['["legacy","old meaning"]'];});await one.flush();
  await two.change(state=>{state.favorites.Q0003=true;});
  await two.offline(false);await two.flush();await one.flush();
  const tombstones=await two.load();
  assert(!tombstones.favorites.Q0001,'deleted question favorite must stay removed');
  assert(!tombstones.words['["legacy","old meaning"]'],'deleted word favorite must stay removed');
  assert(tombstones.favorites.Q0003,'unrelated stale device addition must remain');
  console.log('PASS offline stale device preserves favorite/word deletions');

  await one.offline(true);await two.offline(true);
  const answer=state=>{state.progress.Q0003={...(state.progress.Q0003||{}),attempts:(state.progress.Q0003?.attempts||0)+1,streak:(state.progress.Q0003?.streak||0)+1};};
  await one.change(answer,{answer:{id:'Q0003',correct:true,verified:true}});
  await two.change(answer,{answer:{id:'Q0003',correct:true,verified:true}});
  await one.offline(false);await two.offline(false);await one.flush();await two.flush();await one.flush();
  assert.equal((await one.load()).progress.Q0003.attempts,2,'concurrent device attempts sum');
  for(let i=0;i<3;i++){await two.flush();await one.flush();}
  assert.equal((await two.load()).progress.Q0003.attempts,2,'same attempts never duplicate');
  console.log('PASS two-device attempts merge once');

  await two.offline(true);
  await one.change(state=>{state.rounds['set-1']={ids:['Q0001','Q0002','Q0003'],answers:{},index:0,done:false,runId:'integration-new-run'};});await one.flush();
  await two.change(state=>{state.rounds['set-1'].answers.Q0002='B';state.rounds['set-1'].index=2;});
  await two.offline(false);await two.flush();await one.flush();
  assert.deepEqual((await two.load()).rounds['set-1'].answers,{},'new round wins late old round update');
  assert.equal((await one.load()).rounds['set-1'].index,0);
  console.log('PASS round restart wins late previous-round progress');

  await one.offline(true);
  await one.change(state=>{state.favorites.Q0009=true;});
  await one.flush();
  assert((await one.load()).favorites.Q0009,'offline changes remain visible');
  await one.offline(false);await one.flush();await two.flush();
  assert((await two.load()).favorites.Q0009,'online retry uploads offline changes');
  console.log('PASS offline local save and reconnect');

  await one.login(userB);await one.flush();
  const accountB=await one.load();assert(!accountB.favorites.Q0009,'B cannot see A favorites');assert(!accountB.progress.Q0001,'B cannot see A progress');
  await one.change(state=>{state.favorites.Q0099=true;});await one.flush();
  await one.login(userA);await one.flush();
  const backA=await one.load();assert(backA.favorites.Q0009,'A restored');assert(!backA.favorites.Q0099,'A cannot see B favorite');
  assert.equal(rows.size,2,'accounts retain separate rows');
  console.log('PASS account isolation on switching');

  await one.flush();await two.flush();
  const start=calls.length;
  const racing=makeGate({count:2});
  await Promise.all([one.change(state=>{state.favorites.Q0010=true;}),two.change(state=>{state.favorites.Q0011=true;})]);
  const flushes=Promise.all([one.flush(),two.flush()]);
  await waitFor(()=>racing.waiters.length>=2,'both concurrent reads');await racing.released;await flushes;
  await one.flush();await two.flush();
  const conflictMerged=await two.load();assert(conflictMerged.favorites.Q0010 && conflictMerged.favorites.Q0011,'CAS conflict retains both updates');
  assert(calls.slice(start).filter(q=>q.op==='update').length>=3,'CAS conflict causes an update retry');
  console.log('PASS simultaneous CAS conflict merges and retries');

  const inFlight=makeGate({count:999,device:'one',user:userA.id});
  const oldSync=one.flush();
  await waitFor(()=>inFlight.waiters.length>=1,'account A read suspended');
  await one.login(userB);
  assert(!(await one.load()).favorites.Q0009,'switch hides A while A request is pending');
  inFlight.forceRelease();await oldSync;await one.flush();
  const afterSwitch=await one.load();
  assert(afterSwitch.favorites.Q0099,'B document remains active after late A response');
  assert(!afterSwitch.favorites.Q0009 && !afterSwitch.favorites.Q0010,'late A response cannot merge into B');
  console.log('PASS late old-account response cannot leak across account switch');

  const inference=await device('inference',userA,null,'thinkcloze_sat_inference_v1');
  await inference.flush();
  assert(!(await inference.load()).favorites.Q0009,'inference does not see context question favorite');
  await inference.change(state=>{state.favorites.Q0382=true;});await inference.flush();
  await two.flush();
  assert(!(await two.load()).favorites.Q0382,'context does not see inference favorite');
  assert.equal(rows.size,3,'two modules use distinct progress namespace for same account');
  console.log('PASS context and inference accounts remain separate');
  const anonymous=await device('anonymous',{id:'anonymous-session',is_anonymous:true});
  await anonymous.change(state=>{state.favorites.Q0020=true;});await anonymous.flush();
  assert.equal(rows.size,3,'anonymous session cannot create an account progress row');
  assert.equal(calls.filter(q=>q.device==='anonymous' && q.op!=='select').length,0);
  console.log('PASS anonymous session remains local');

  const sameOrigin=await browser.newContext();contexts.push(sameOrigin);
  const tabNamespace='test_first_legacy_v1';
  const tabUser={id:'same-origin-account',email:'same-origin@invalid.test'};
  const [tabOne,tabTwo]=await Promise.all([
    device('tab-one',null,legacy,tabNamespace,sameOrigin),
    device('tab-two',null,legacy,tabNamespace,sameOrigin),
  ]);
  assert.equal((await tabOne.load()).progress.Q0001.attempts,2);
  assert.equal((await tabTwo.load()).progress.Q0001.attempts,2);
  const guestObserver=await device('guest-observer',null,legacy,tabNamespace,sameOrigin);
  await Promise.all([tabOne.login(tabUser),tabTwo.login(tabUser)]);
  await tabOne.flush();await tabTwo.flush();await tabOne.flush();
  assert.equal((await tabOne.load()).progress.Q0001.attempts,2,'same-origin simultaneous legacy import must count once');
  const tabRow=[...rows.values()].find(row=>row.user_id===tabUser.id && row.progress_id===tabNamespace);
  assert.equal(Object.keys(tabRow.progress.seeds).length,1,'first import uses one stable browser seed');
  await waitFor(async()=>!(await guestObserver.load()).progress.Q0001,'guest claim clears another guest tab without resurrection');
  await guestObserver.change(state=>{state.favorites.Q0444=true;});
  assert(!(await guestObserver.load()).progress.Q0001,'new guest activity cannot revive imported account history');
  await Promise.all([
    tabOne.change(state=>{state.progress.Q0005={attempts:(state.progress.Q0005?.attempts||0)+1};},{answer:{id:'Q0005',correct:true,verified:true}}),
    tabTwo.change(state=>{state.progress.Q0005={attempts:(state.progress.Q0005?.attempts||0)+1};},{answer:{id:'Q0005',correct:true,verified:true}}),
  ]);
  await tabOne.flush();await tabTwo.flush();await tabOne.flush();
  assert.equal((await tabOne.load()).progress.Q0005.attempts,2,'two tabs have distinct attempt writers');
  const finalTabRow=[...rows.values()].find(row=>row.user_id===tabUser.id && row.progress_id===tabNamespace);
  assert.equal(Object.keys(finalTabRow.progress.attempts.Q0005).length,2,'one G-counter writer per tab');
  console.log('PASS same-origin first migration once and unique tab attempt writers');

  const quota=await device('quota',userA);
  await quota.page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('test quota exceeded','QuotaExceededError')};window.__offline=true;});
  await quota.change(state=>{state.favorites.Q0201=true;});
  assert.equal(await quota.page.evaluate(()=>sync.storageAvailable),false);
  await quota.login(userB);
  assert(!(await quota.load()).favorites.Q0201,'quota-limited B cannot see A changes');
  await quota.change(state=>{state.favorites.Q0202=true;});
  await quota.login(userA);
  assert((await quota.load()).favorites.Q0201,'in-memory A changes survive A -> B -> A under quota');
  assert(!(await quota.load()).favorites.Q0202,'quota-limited account isolation');
  console.log('PASS quota failure retains current-page account memories');

  const futureKey=[...rows.keys()].find(key=>{const row=rows.get(key);return row.user_id===userA.id && row.progress_id===namespace});
  const originalRow=clone(rows.get(futureKey));
  rows.set(futureKey,{...originalRow,progress:{...clone(originalRow.progress),version:2},updated_at:stamp()});
  const beforeFuture=calls.length;
  await two.change(state=>{state.favorites.Q0300=true;});await two.flush();
  assert.equal(rows.get(futureKey).progress.version,2,'future cloud version cannot be overwritten');
  assert.equal(calls.slice(beforeFuture).filter(q=>q.device==='two' && q.op!=='select').length,0);
  assert((await two.load()).favorites.Q0300,'local changes preserved on cloud incompatibility');
  assert.equal(await two.page.evaluate(()=>sync.status),'error');
  rows.set(futureKey,originalRow);
  console.log('PASS same-format future cloud version is preserved');
  assert.deepEqual(errors,[],'no browser script errors');
  console.log(JSON.stringify({result:'PASS',cloudRows:rows.size,requests:calls.length,cases:14}));
 } finally {if(gate){gate.release();gate=null}await Promise.all(contexts.map(c=>c.close()));await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
