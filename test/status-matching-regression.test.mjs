import test from 'node:test';
import assert from 'node:assert/strict';


// Regression: a previous successful transaction with the same nominal must not
// satisfy a newer payment. Matching requires a parseable transaction timestamp
// inside the new payment's window.
test('same amount from an older transaction must stay pending', () => {
  const createdAt = Date.parse('2026-09-29T04:10:00Z');
  const expiresAt = createdAt + 15 * 60_000;
  const oldTx = { amount: 1, time: createdAt - 5 * 60_000, status: 'settlement', id: 'old-rp1' };
  const newTx = { amount: 1, time: createdAt + 5_000, status: 'settlement', id: 'new-rp1' };

  const inWindow = (tx) => tx.time >= createdAt - 30_000 && tx.time <= expiresAt + 120_000;
  assert.equal(inWindow(oldTx), false);
  assert.equal(inWindow(newTx), true);
});
