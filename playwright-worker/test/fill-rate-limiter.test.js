import test from 'node:test';
import assert from 'node:assert/strict';
import { createFillRateLimiter } from '../src/fill-rate-limiter.js';

const opts = { maxFieldsPerOperation: 4, maxFormFills: 2, maxFieldWrites: 5, windowMs: 60000 };
test('window expires without restarting a long-lived external Edge', () => {
 const rate=createFillRateLimiter();
 for (const now of [100, 200]) {
   const id=rate.reserve({ ...opts, requestedWrites: 1, now }); rate.commit(id, now);
 }
 assert.throws(() => rate.reserve({ ...opts, requestedWrites: 1, now: 300 }),
   error => error.webStatus === 'WEB_RATE_LIMITED');
 const id=rate.reserve({ ...opts, requestedWrites: 1, now: 60101 });
 rate.commit(id, 60101);
 assert.equal(rate.snapshot({now:60101,windowMs:60000}).formFillsInWindow,2);
});
test('per-request bound is independent of old worker totals', () => {
 const rate=createFillRateLimiter();
 assert.throws(() => rate.reserve({...opts,requestedWrites:5,now:100}), error => error.webStatus === 'WEB_OPERATION_SIZE_LIMIT');
 assert.equal(rate.snapshot({now:100,windowMs:60000}).formFillsInWindow,0);
});
test('failed operations release reservations and never consume a quota slot', () => {
 const rate=createFillRateLimiter();
 const a=rate.reserve({...opts,requestedWrites:3,now:0});
 assert.throws(() => rate.reserve({...opts,requestedWrites:3,now:0}), error => error.webStatus === 'WEB_RATE_LIMITED');
 rate.release(a);
 const b=rate.reserve({...opts,requestedWrites:3,now:0});
 rate.commit(b,0);
 assert.equal(rate.snapshot({now:1,windowMs:60000}).fieldWritesInWindow,3);
});
test('write-window retryAfter reflects the last required expiration', () => {
 const rate=createFillRateLimiter();
 const config={maxFieldsPerOperation:4,maxFormFills:10,maxFieldWrites:5,windowMs:60000};
 for (const [at,writes] of [[100,1],[200,3]]) {
  const id=rate.reserve({...config,requestedWrites:writes,now:at});
  rate.commit(id,at);
 }
 assert.throws(()=>rate.reserve({...config,requestedWrites:3,now:300}),error=>{
  assert.equal(error.webStatus,'WEB_RATE_LIMITED');
  assert.equal(error.evidence.kind,'field-write');
  assert.equal(error.evidence.retryAfterMs,59900);
  return true;
 });
 const id=rate.reserve({...config,requestedWrites:3,now:60200});
 rate.commit(id,60200);
});
test('request above write-window capacity rejects as size not permanent rate-limit', () => {
 const rate=createFillRateLimiter();
 assert.throws(()=>rate.reserve({maxFieldsPerOperation:10,maxFormFills:20,maxFieldWrites:5,
  windowMs:60000,requestedWrites:6,now:0}),e=>e.webStatus==='WEB_OPERATION_SIZE_LIMIT');
});

test('independent worker limiter instances are not shared across workers',()=>{
 const a=createFillRateLimiter(), b=createFillRateLimiter();
 const token=a.reserve({...opts,requestedWrites:1,now:0});
 a.commit(token,0);
 assert.equal(b.snapshot({now:0,windowMs:60000}).formFillsInWindow,0);
});
