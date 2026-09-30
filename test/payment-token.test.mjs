import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PAYMENT_SIGNING_SECRET = 'test-stable-secret-123';
const { issuePaymentToken, verifyPaymentToken } = await import('../payment-token.js');

test('payment token can recover payment metadata across instances', () => {
  const payment = {
    id: 'xiao-web-123456',
    amount: 20000,
    createdAt: 1788058800000,
    expiresAt: 1788059700000,
    source: 'web'
  };
  const token = issuePaymentToken(payment);
  assert.ok(token.includes('.'));
  assert.deepEqual(verifyPaymentToken(token, payment.id), payment);
  assert.equal(verifyPaymentToken(token, 'xiao-api-123456'), null);
});
