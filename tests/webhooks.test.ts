import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { computeSignature, verifyWebhookSignature } from '../src/webhooks.js';

const SECRET = 'whsec_test_secret_1234567890';
const BODY = JSON.stringify({ id: 'wh_abc123', event: 'call.ended', data: { call_id: 456 } });

test('computeSignature matches a hand-computed HMAC-SHA256', () => {
  const expected = 'sha256=' + createHmac('sha256', SECRET).update(BODY).digest('hex');
  assert.equal(computeSignature(BODY, SECRET), expected);
});

test('verifyWebhookSignature accepts a correctly-signed body', () => {
  const sig = computeSignature(BODY, SECRET);
  assert.equal(verifyWebhookSignature(BODY, sig, SECRET), true);
});

test('verifyWebhookSignature rejects a tampered body', () => {
  const sig = computeSignature(BODY, SECRET);
  const tampered = BODY.replace('456', '999');
  assert.equal(verifyWebhookSignature(tampered, sig, SECRET), false);
});

test('verifyWebhookSignature rejects the wrong secret', () => {
  const sig = computeSignature(BODY, SECRET);
  assert.equal(verifyWebhookSignature(BODY, sig, 'whsec_wrong_secret'), false);
});

test('verifyWebhookSignature rejects a missing header', () => {
  assert.equal(verifyWebhookSignature(BODY, null, SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, undefined, SECRET), false);
});

test('verifyWebhookSignature rejects a malformed header without throwing', () => {
  assert.equal(verifyWebhookSignature(BODY, 'not-a-real-signature', SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, 'sha256=', SECRET), false);
});

test('verifyWebhookSignature works against a Buffer body identically to a string', () => {
  const buf = Buffer.from(BODY, 'utf8');
  const sig = computeSignature(buf, SECRET);
  assert.equal(verifyWebhookSignature(buf, sig, SECRET), true);
  assert.equal(sig, computeSignature(BODY, SECRET));
});
