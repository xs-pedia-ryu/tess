import crypto from 'node:crypto';

function getSecret() {
  const secret = String(
    process.env.PAYMENT_SIGNING_SECRET ||
    process.env.API_KEY ||
    process.env.GOPAY_PASSWORD ||
    process.env.GOPAY_EMAIL ||
    process.env.QRIS_STRING ||
    ''
  );
  if (!secret) {
    throw new Error('PAYMENT_SIGNING_SECRET belum diisi. Set secret untuk status/cancel lintas instance.');
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export function issuePaymentToken(payment) {
  const body = {
    v: 1,
    id: payment.id,
    amount: Number(payment.amount),
    createdAt: Number(payment.createdAt),
    expiresAt: Number(payment.expiresAt),
    source: payment.source || 'web'
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPaymentToken(token, expectedId = null) {
  try {
    const [encoded, signature] = String(token || '').split('.');
    if (!encoded || !signature) return null;
    const expected = Buffer.from(sign(encoded));
    const supplied = Buffer.from(signature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

    const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (body?.v !== 1 || !body.id || !Number.isFinite(Number(body.amount)) || !Number.isFinite(Number(body.createdAt)) || !Number.isFinite(Number(body.expiresAt))) {
      return null;
    }
    if (expectedId && String(body.id) !== String(expectedId)) return null;
    return {
      id: String(body.id),
      amount: Number(body.amount),
      createdAt: Number(body.createdAt),
      expiresAt: Number(body.expiresAt),
      source: body.source === 'api' ? 'api' : 'web'
    };
  } catch {
    return null;
  }
}
