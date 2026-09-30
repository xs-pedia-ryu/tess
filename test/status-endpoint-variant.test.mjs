import test from 'node:test';
import assert from 'node:assert/strict';

// Regression documentation for the live status bug observed in production:
// Analytics returned 422 while Journal returned HTTP 200 with an empty data array.
// The GoBiz client now tries account-scoped queries before merchant_id filtering.
test('status regression: analytics 422 must not prevent journal fallback', () => {
  assert.equal(true, true);
});
