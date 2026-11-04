import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['tool/dom-capture-live-cdp-smoke.mjs','60B915E9C823F51FA8ED420587CC37E0'],{env:{...process.env,DEBUG:'pw:protocol'}});
let sent=0,received=0;const methods=new Map();const errors=[];const outstanding=new Map();
child.stderr.on('data',chunk=>{for(const line of String(chunk).split('\n')){if(line.includes('SEND ►')){sent++;const m=line.match(/"method":"([^"]+)"/);if(m)methods.set(m[1],(methods.get(m[1])||0)+1);const id=line.match(/"id":(\d+)/);if(id&&m)outstanding.set(id[1],m[1]);}if(line.includes('◀ RECV')){received++;const id=line.match(/"id":(\d+)/);if(id)outstanding.delete(id[1]);}if(/TimeoutError|Error:|browserType.connectOverCDP/.test(line))errors.push(line.slice(0,240));}});
child.stdout.on('data',chunk=>process.stdout.write(chunk));
const timeout=setTimeout(()=>child.kill('SIGTERM'),52000);
child.on('close',(code,signal)=>{clearTimeout(timeout);console.log(JSON.stringify({status:'PLAYWRIGHT_ATTACH_TRACE',code,signal,sent,received,methods:[...methods].sort((a,b)=>b[1]-a[1]).slice(0,25),pending:[...outstanding].slice(-30),errors:errors.slice(-2)}));});
