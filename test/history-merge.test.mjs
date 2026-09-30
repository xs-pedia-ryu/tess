import test from 'node:test';
import assert from 'node:assert/strict';

test('QRIS status matching should prefer a successful transaction in the payment window', () => {
  const createdAt = Date.parse('2026-09-29T04:00:00Z');
  const expiresAt = createdAt + 15 * 60_000;
  const histories = [
    { amount: 10, time: createdAt - 120_000, status: 'settlement', id: 'old' },
    { amount: 10, time: createdAt + 90_000, status: 'settlement', id: 'new' },
    { amount: 20, time: createdAt + 60_000, status: 'settlement', id: 'other' }
  ];
  const matches = histories
    .filter(x => x.amount === 10)
    .filter(x => x.time >= createdAt - 30_000 && x.time <= expiresAt + 120_000)
    .filter(x => x.status === 'settlement')
    .sort((a,b) => b.time - a.time);
  assert.equal(matches[0].id, 'new');
});
