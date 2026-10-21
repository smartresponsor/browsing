import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTargetedReadCapture, readPostconditionTargetId } from '../playwright-worker/src/targeted-capture-policy.js';

const target='A'.repeat(32), other='B'.repeat(32);
assert.equal(isTargetedReadCapture('/page-capture',{targetId:target,captureView:'dom'}),true);
assert.equal(isTargetedReadCapture('/page-capture',{targetId:target,captureView:'form'}),true);
assert.equal(isTargetedReadCapture('/page-capture',{targetId:target,screenshot:false}),true);
for(const path of ['/click','/open','/browser-bind','/submit-after-approval','/fill-after-approval'])assert.equal(isTargetedReadCapture(path,{targetId:target}),false);
for(const value of [null,undefined,'', 'other-target', 'A'.repeat(31)])assert.equal(isTargetedReadCapture('/page-capture',{targetId:value}),false);
assert.equal(readPostconditionTargetId(true,target,other),target);
assert.equal(readPostconditionTargetId(false,target,other),other);
assert.equal(readPostconditionTargetId(false,target,null),target);

const worker=fs.readFileSync(new URL('../playwright-worker/src/worker.js',import.meta.url),'utf8');
const defs=fs.readFileSync(new URL('../mcp-server/src/web-domain-tool-definitions.cjs',import.meta.url),'utf8');
const ensure=worker.slice(worker.indexOf('async function ensurePage()'),worker.indexOf('async function connectToExistingCdpEndpoint'));
assert.ok(ensure.includes('guard?.evidence?.targetId'), 'Capture must select native-verified exact target ID');
assert.ok(ensure.includes('if (!guard.preserveActiveTarget) page = selected'), 'Explicit read must not alter shared active page');
assert.ok(ensure.includes('if (guard?.ok && !policy.externalVisibleChrome)'), 'Verified target must not launch independent browser');
const route=worker.slice(worker.indexOf("app.post('/page-capture'"),worker.indexOf("app.post('/wait-for-ready'"));
assert.ok(route.includes('if (!visibleRequest.getStore()?.preserveActiveTarget) await target.bringToFront()'), 'Explicit read cannot steal visible focus');
assert.ok(worker.includes('readPostconditionTargetId(preserveActiveTarget'), 'Postcondition must check requested target, not shared active pointer');
assert.ok(worker.includes('if (after.ok && !preserveActiveTarget) boundVisibleRuntime = after.evidence'), 'Read must not rewrite shared session identity');
for(const name of ['web.page.capture.dom','web.page.capture.form']) {
 const start=defs.indexOf("canonicalName: '"+name+"'");
 const part=defs.slice(start,start+680);
 assert.ok(start>0&&part.includes('targetId: z.string().regex('),name+' must accept exact target');
 assert.ok(part.includes('targetId: input.targetId'),name+' must forward exact target');
}
console.log('Targeted read capture preserves active browser binding, foreground, native gate and postcondition identity.');
