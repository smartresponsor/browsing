import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cdpRequests=[];
const cdp=createServer((req,res)=>{cdpRequests.push({method:req.method,url:req.url});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/json/list'?[{id:'invisible-target',type:'page',url:'about:blank'}]:{webSocketDebuggerUrl:`ws://127.0.0.1:${cdp.address().port}/devtools/browser/invisible-instance`}));});
cdp.listen(0,'127.0.0.1');await once(cdp,'listening');
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const workerPort=reserve.address().port;reserve.close();await once(reserve,'close');
const worker=spawn(process.execPath,[fileURLToPath(new URL('../playwright-worker/src/worker.js',import.meta.url))],{env:{...process.env,PORT:String(workerPort),BROWSER_MCP_REMOTE_DEBUGGING_PORT:String(cdp.address().port),BROWSER_MCP_BROWSER_WORKER_TOKEN:'fixture-token',BROWSER_MCP_HEADLESS:'true'},stdio:['ignore','pipe','pipe']});
let output='';worker.stdout.on('data',b=>output+=b);worker.stderr.on('data',b=>output+=b);
const url=`http://127.0.0.1:${workerPort}`;
try {
 for(let i=0;i<100;i++){try{const r=await fetch(url+'/healthz');if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,50));}
 const health=await (await fetch(url+'/healthz')).json();assert.equal(health.browserVisible,false);assert.notEqual(health.visibility_verified,true);
 const post=async(route,body={})=>(await fetch(url+route,{method:'POST',headers:{authorization:'Bearer fixture-token','content-type':'application/json'},body:JSON.stringify(body)})).json();
 for(const route of ['/browser-bind','/open','/open-job','/page-capture','/inspect','/extract-form','/propose','/fill-after-approval','/upload-artifact','/click','/review-before-submit','/submit-after-approval']){
  const r=await post(route,{targetId:'invisible-target',url:'https://example.invalid',approved:false});
  assert.equal(r.ok,false,route);assert.equal(r.status,'WEB_VISIBLE_SESSION_REQUIRED',route);assert.equal(r.mutation_attempted,false,route);
 }
 for(const route of ['/browser-restart','/browser-kill','/open-fresh']){
  const r=await post(route);assert.equal(r.reason,'RECOVERY_REQUIRES_CONSOLE_ORCHESTRATION');
 }
 const diagnostic=await post('/browser-cdp-targets');assert.equal(diagnostic.visibility_verified,false);assert.ok(diagnostic.targets.some(t=>t.id==='invisible-target'));
 const targets=await post('/browser-targets');assert.equal(targets.activeTargetId,null);assert.equal(targets.targets[0].targetId,'invisible-target');assert.equal(targets.visibility_verified,false);
 const unauthorized=await fetch(url+'/open',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(unauthorized.status,401);
 assert.ok(cdpRequests.length>0);assert.ok(cdpRequests.every(p=>p.method==='GET' && ['/json/list','/json/version','/devtools/browser/invisible-instance'].includes(p.url)),'Failure must preserve existing targets and perform no mutations');
 console.log('Worker visible session integration PASS: 12 automation routes fail closed, 3 lifecycle routes cannot launch, diagnostics and token gate retained, no target mutation.');
} catch(e){console.error(output);throw e;} finally {if (worker.exitCode === null) {worker.kill('SIGTERM');await once(worker,'exit');}cdp.close();await once(cdp,'close');}
