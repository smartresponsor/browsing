// Read-only browser-level CDP command timing, without Playwright attachment.
const endpoint = 'http://127.0.0.1:9224';
const version = await fetch(endpoint + '/json/version').then(r => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
ws.addEventListener('message', event => {
 const msg = JSON.parse(String(event.data));
 const request = pending.get(msg.id);
 if (request) { pending.delete(msg.id); request.resolve(msg); }
});
await Promise.race([new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('WS_CONNECT_TIMEOUT')),5000))]);
async function command(method, params={}) {
 const id=nextId++; const started=Date.now();
 const response=await Promise.race([new Promise(resolve=>{pending.set(id,{resolve});ws.send(JSON.stringify({id,method,params}));}),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),8000))]);
 pending.delete(id);
 return {method,elapsedMs:Date.now()-started,timeout:!!response.timeout,error:response.error?.message||null,targetCount:response.result?.targetInfos?.length??null};
}
try {
 for(const method of ['Browser.getVersion','Target.getBrowserContexts','Target.getTargets']) {
  const params=method==='Target.setDiscoverTargets'?{discover:true}:method==='Target.setAutoAttach'?{autoAttach:true,waitForDebuggerOnStart:false,flatten:true}:{};
  console.log(JSON.stringify(await command(method,params)));
 }
} finally { ws.close(); }
