import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gobiz-gateway-test-'));
process.env.DATA_DIR = tmpDir;

const store = await import('../payment-store.js');


test('payment IDs use the requested source prefix and six random digits', () => {
  const webIds = Array.from({ length: 20 }, () => store.makePaymentId('web'));
  const apiIds = Array.from({ length: 20 }, () => store.makePaymentId('api'));
  for (const id of webIds) assert.match(id, /^xiao-web-\d{6}$/);
  for (const id of apiIds) assert.match(id, /^xiao-api-\d{6}$/);
});

test('created payment keeps its source', () => {
  const now = Date.now();
  const web = store.createPayment({ amount: 1000, createdAt: now, expiresAt: now + 900000, qrisString: '000201', source: 'web' });
  const api = store.createPayment({ amount: 2000, createdAt: now + 1, expiresAt: now + 900001, qrisString: '000201', source: 'api' });
  assert.match(web.id, /^xiao-web-\d{6}$/);
  assert.equal(web.source, 'web');
  assert.match(api.id, /^xiao-api-\d{6}$/);
  assert.equal(api.source, 'api');
});
