import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSameOrigin } from '../src/lib/security.js';

function fakeReq(method, headers) {
  return { method, get: (name) => headers[name.toLowerCase()] };
}

test('requireSameOrigin: GET/HEAD are never checked (not state-changing)', () => {
  let called = false;
  requireSameOrigin(fakeReq('GET', { origin: 'http://evil.example.com', host: 'app.internal' }), {}, () => { called = true; });
  assert.equal(called, true);
});

test('requireSameOrigin: POST with no Origin header passes through (SameSite=Lax is the primary defense)', () => {
  let called = false;
  requireSameOrigin(fakeReq('POST', { host: 'app.internal' }), {}, () => { called = true; });
  assert.equal(called, true);
});

test('requireSameOrigin: POST with a matching Origin passes', () => {
  let called = false;
  requireSameOrigin(fakeReq('POST', { origin: 'https://app.internal', host: 'app.internal' }), {}, () => { called = true; });
  assert.equal(called, true);
});

test('requireSameOrigin: POST with a cross-site Origin is rejected with 403', () => {
  let errArg;
  requireSameOrigin(fakeReq('POST', { origin: 'http://evil.example.com', host: 'app.internal' }), {}, (err) => { errArg = err; });
  assert.ok(errArg, 'next() was called with an error');
  assert.equal(errArg.status, 403);
});

test('requireSameOrigin: DELETE with a cross-site Origin is also rejected', () => {
  let errArg;
  requireSameOrigin(fakeReq('DELETE', { origin: 'http://evil.example.com', host: 'app.internal' }), {}, (err) => { errArg = err; });
  assert.equal(errArg?.status, 403);
});

test('requireSameOrigin: same host but different port counts as cross-origin (Origin includes port)', () => {
  let errArg;
  requireSameOrigin(fakeReq('POST', { origin: 'http://app.internal:8080', host: 'app.internal' }), {}, (err) => { errArg = err; });
  assert.equal(errArg?.status, 403);
});
