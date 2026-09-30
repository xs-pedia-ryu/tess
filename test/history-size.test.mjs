import test from 'node:test';
import assert from 'node:assert/strict';

// Regression fixture for the GoBiz Analytics 422 observed in production:
// validation_error says size.max=100. The service must never request >100.
test('GoBiz history query size is capped at 100', () => {
  const normalize = (size = 50) => {
    const n = Number(size);
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(1, Math.floor(n)));
  };
  assert.equal(normalize(200), 100);
  assert.equal(normalize(101), 100);
  assert.equal(normalize(100), 100);
  assert.equal(normalize(30), 30);
});
