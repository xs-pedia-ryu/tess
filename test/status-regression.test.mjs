import test from 'node:test';
import assert from 'node:assert/strict';

const success = new Set(['settlement','settled','capture','captured','success','successful','paid','completed','complete','done','succeeded']);
const failed = new Set(['failed','fail','error','rejected','reject','declined','cancelled','canceled','void','voided','expired','pending','created','initiated','refunded','refund','reversed']);
function isSuccessful(status) {
  if (!status) return true;
  if (failed.has(status)) return false;
  if (success.has(status)) return true;
  return true;
}

test('success status variants are accepted', () => {
  for (const status of ['success','successful','paid','completed','settlement','capture']) {
    assert.equal(isSuccessful(status), true, status);
  }
});

test('failure and pending status variants are rejected', () => {
  for (const status of ['failed','rejected','cancelled','expired','pending']) {
    assert.equal(isSuccessful(status), false, status);
  }
});
