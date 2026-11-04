import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttachTarget } from './attach-target-policy.js';
const id='6DD7FB4EE7A42182E47C8EA06DFABCFA';
test('internal Edge discards target is excluded',()=>assert.deepEqual(classifyAttachTarget({id,type:'page',url:'edge://discards/'}),{eligible:false,reason:'INTERNAL_BROWSER_PAGE'}));
test('ordinary HTTPS target is eligible',()=>assert.deepEqual(classifyAttachTarget({id,type:'page',url:'https://example.org/'}),{eligible:true,reason:'WEB_PAGE'}));
test('non-page targets are excluded',()=>assert.equal(classifyAttachTarget({id,type:'service_worker',url:'https://example.org/'}).eligible,false));
test('invalid target IDs are excluded',()=>assert.equal(classifyAttachTarget({id:'invalid',type:'page',url:'https://example.org/'}).eligible,false));
