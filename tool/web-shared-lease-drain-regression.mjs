import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createWorkerDrainController } from "../playwright-worker/src/worker-drain.js";
import { failureEnvelope, classifyVisibleFailure } from "../playwright-worker/src/failure-envelope.js";
const { acquireVisibleProcessLease, inspectVisibleProcessLeaseRoot } = await import(pathToFileURL(join(process.argv[2], "dist/service/visible-browser-process-lock.js")).href);
const drainController=createWorkerDrainController();
const worker = readFileSync(new URL("../playwright-worker/src/worker.js",import.meta.url),"utf8");
const start=worker.indexOf("const visibleRequest = new AsyncLocalStorage();"),end=worker.indexOf("app.post('/browser-status'",start);
assert.ok(start>=0&&end>start);
const source=worker.slice(start,end);
const imp="const { acquireVisibleProcessLease, inspectVisibleProcessLeaseRoot } = await import(await resolveConsoleService('visible-browser-process-lock.js'));";
assert.equal(source.split(imp).length,2);
assert.equal(worker.match(/^app\.post\(.+, guardedPost\(async \(/gm)?.length,27);
assert.ok(!source.includes("res.once('finish'"));
const root=mkdtempSync(join(tmpdir(),"worker-delegation-"));
const priorRoot=process.env.CONSOLE_MCP_VISIBLE_LEASE_ROOT,priorMode=process.env.CONSOLE_MCP_VISIBLE_OS_LEASES;
process.env.CONSOLE_MCP_VISIBLE_LEASE_ROOT=root;process.env.CONSOLE_MCP_VISIBLE_OS_LEASES="required";
const anchor={endpoint:"http://127.0.0.1:9223",browserInstance:"/devtools/browser/fixture",targetId:"A".repeat(32)};
const key=JSON.stringify([anchor.endpoint,anchor.browserInstance]),proof={ok:true,evidence:anchor};
let middleware,entered,finishRoute,finishPost,routeDone,postEntered,count=0,probes=0,holdPost=false;
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const app={use(fn){middleware=fn;}};
const build=new Function("app","AsyncLocalStorage","randomUUID","getPolicy","parseBrowserWorkerToken","grantsPolicy","isTargetedReadCapture","page","getPageTargetId","inspectVisibleTarget","selectVisibleTarget","readPostconditionTargetId","acquireVisibleProcessLease","inspectVisibleProcessLeaseRoot","drainController","failureEnvelope","classifyVisibleFailure","normalizeError",source.replace(imp,"")+"\nreturn guardedPost;");
const guarded=build(app,AsyncLocalStorage,randomUUID,()=>({remoteDebuggingPort:9223}),()=>"fixture-token",null,()=>false,null,async()=>anchor.targetId,async()=>{
  probes++;if(holdPost&&probes>=2){postEntered.resolve();await finishPost.promise;}return proof;
},async()=>proof,(_preserve,id)=>id,acquireVisibleProcessLease,inspectVisibleProcessLeaseRoot,drainController,failureEnvelope,classifyVisibleFailure,e=>String(e));
const route=guarded(async(_req,res)=>{count++;entered.resolve();await finishRoute.promise;res.json({ok:true});});
const server=createServer(async(req,res)=>{
  req.body={targetId:anchor.targetId};
  Object.defineProperty(req,"path",{get(){return new URL(req.url,"http://fixture").pathname;}});
  res.status=code=>{res.statusCode=code;return res;};
  res.json=body=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(body));return res;};
  try{await middleware(req,res,()=>route(req,res));}catch{if(!res.destroyed&&!res.headersSent)res.status(500).json({ok:false});}
  finally{routeDone?.resolve();}
});
const send=path=>new Promise((resolve,reject)=>{
  const q=request({host:"127.0.0.1",port:server.address().port,path,method:"POST"},res=>{let text="";res.on("data",c=>text+=c);res.on("end",()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});q.on("error",reject);q.end();
});
try{
  server.listen(0,"127.0.0.1");await once(server,"listening");
  assert.equal((await send("/click")).body.status,"WEB_SHARED_LEASE_PROTOCOL_REQUIRED");
  assert.equal((await send("/lease-v1/unknown")).status,404);
  assert.equal((await send("/lease-v1/click")).body.status,"WEB_SHARED_LEASE_ROOT_MISMATCH");assert.equal(count,0);
  entered=defer();finishRoute=defer();finishPost=defer();postEntered=defer();routeDone=defer();holdPost=true;probes=0;
  const q=request({host:"127.0.0.1",port:server.address().port,path:"/lease-v1/click",method:"POST",headers:{"x-console-browser-lease-root":inspectVisibleProcessLeaseRoot().identity}});
  q.on("error",()=>{});q.end();
  await entered.promise;q.destroy();await delay(25);
  assert.equal(drainController.drain().status,"WORKER_DRAINING");
  assert.equal(drainController.snapshot().activeOperations,1);
  assert.equal((await acquireVisibleProcessLease(key,"browser",null)).reason,"CROSS_PROCESS_LEASE_BUSY");
  finishRoute.resolve();await postEntered.promise;
  assert.equal((await acquireVisibleProcessLease(key,"browser",null)).reason,"CROSS_PROCESS_LEASE_BUSY");
  assert.equal(drainController.snapshot().activeOperations,1);
  finishPost.resolve();await routeDone.promise;
  assert.equal(drainController.snapshot().status,"WORKER_DRAINED");
  assert.equal(drainController.snapshot().activeOperations,0);
  const recovered=await acquireVisibleProcessLease(key,"browser",null);assert.equal(recovered.ok,true);await recovered.release();
  assert.equal((await send("/lease-v1/click")).body.status,"WEB_WORKER_DRAINING");
  assert.equal(count,1);
  drainController.resume();
  console.log("WORKER_LEASE_DRAIN_RECONCILIATION_PASS real HTTP disconnect, actual flock and upstream drain controller; mock CDP admission");
}finally{
  finishRoute?.resolve();finishPost?.resolve();server.closeAllConnections();await new Promise(r=>server.close(r));
  if(priorRoot===undefined)delete process.env.CONSOLE_MCP_VISIBLE_LEASE_ROOT;else process.env.CONSOLE_MCP_VISIBLE_LEASE_ROOT=priorRoot;
  if(priorMode===undefined)delete process.env.CONSOLE_MCP_VISIBLE_OS_LEASES;else process.env.CONSOLE_MCP_VISIBLE_OS_LEASES=priorMode;
  rmSync(root,{recursive:true,force:true});
}
