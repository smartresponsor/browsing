import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['tool/dom-capture-live-cdp-smoke.mjs','60B915E9C823F51FA8ED420587CC37E0'],{env:{...process.env,DEBUG:'pw:protocol'}});
const pending=new Map(),sessions=new Map(),targetTypes=new Map();let sends=0,receives=0,buffer='';
function consume(line){const send=line.includes('SEND ►'),recv=line.includes('◀ RECV');if(!send&&!recv)return;const start=line.indexOf('{');if(start<0)return;let message;try{message=JSON.parse(line.slice(start));}catch{return;}
 if(send){sends++;if(message.id)pending.set(message.id,{method:message.method,sessionId:message.sessionId||null});}
 if(recv){receives++;if(message.id)pending.delete(message.id);if(message.method==='Target.attachedToTarget'){const p=message.params||{};if(p.sessionId){sessions.set(p.sessionId,{targetId:p.targetInfo?.targetId||null,type:p.targetInfo?.type||null,url:p.targetInfo?.url||null,title:p.targetInfo?.title||null,openerId:p.targetInfo?.openerId||null});targetTypes.set(p.targetInfo?.targetId||'',p.targetInfo?.type||'');}}}
}
child.stderr.on('data',chunk=>{buffer+=String(chunk);let index;while((index=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,index));buffer=buffer.slice(index+1);}if(buffer.length>1000000)buffer='';});
child.stdout.on('data',chunk=>process.stdout.write(chunk));
const timer=setTimeout(()=>child.kill('SIGTERM'),52000);
child.on('close',(code,signal)=>{clearTimeout(timer);const unresolved=[...pending].map(([id,p])=>({id,method:p.method,sessionId:p.sessionId,target:sessions.get(p.sessionId)||null}));console.log(JSON.stringify({status:'PLAYWRIGHT_TARGET_TRACE',code,signal,sends,receives,sessionCount:sessions.size,targetTypes:[...new Set(targetTypes.values())],unresolved:unresolved.slice(-20)}));});
