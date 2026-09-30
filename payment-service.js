import GoPayMerchant, { GoPayWatcher } from './gobiz.js';
import {
  createPayment,
  getPayment,
  updatePayment,
  getPendingPayments,
  expireOldPayments,
  allPayments
} from './payment-store.js';
import { buildDynamicQris, qrisDataUrl } from './qris.js';
import { issuePaymentToken, verifyPaymentToken } from './payment-token.js';

const PAYMENT_TTL_MS = 15 * 60_000;
const WATCHER_INTERVAL = Math.max(5000, Number(process.env.WATCHER_INTERVAL_MS || 5000));
const HISTORY_QUERY_SIZE = 100;

let merchantInstance;
let watcherInstance;
let watcherStarted = false;
let lastStatusDiagnostics = null;

function getMerchant() {
  if (!merchantInstance) merchantInstance = new GoPayMerchant();
  return merchantInstance;
}

export async function createQrPayment(amount, { source = 'web' } = {}) {
  const numericAmount = Number(amount);
  if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
    throw new Error('Nominal harus berupa bilangan bulat positif.');
  }

  const staticQris = process.env.QRIS_STRING;
  if (!staticQris) throw new Error('QRIS_STRING belum diisi di environment variable.');

  const dynamicQris = buildDynamicQris(staticQris, numericAmount);
  const imageDataUrl = await qrisDataUrl(dynamicQris);

  const createdAt = Date.now();
  const expiresAt = createdAt + PAYMENT_TTL_MS;
  const payment = createPayment({
    amount: numericAmount,
    createdAt,
    expiresAt,
    qrisString: dynamicQris,
    source
  });

  return {
    ...payment,
    expiresInMs: PAYMENT_TTL_MS,
    qr: imageDataUrl,
    qrisString: dynamicQris,
    paymentToken: issuePaymentToken(payment)
  };
}

export async function getPaymentStatus(id, { liveCheck = false, paymentToken = null } = {}) {
  expireOldPayments();
  let payment = getPayment(id);

  // Vercel/serverless can route the status request to a fresh instance where
  // the local JSON store is not available. A signed payment token lets us
  // reconstruct the payment metadata and perform the same live GoBiz check.
  if (!payment && paymentToken) {
    const proof = verifyPaymentToken(paymentToken, id);
    if (proof) {
      payment = {
        id: proof.id,
        amount: proof.amount,
        createdAt: proof.createdAt,
        expiresAt: proof.expiresAt,
        status: 'pending',
        paidAt: null,
        transactionId: null,
        source: proof.source
      };
    }
  }

  if (!payment) return null;

  if (payment.status === 'pending' && Date.now() >= Number(payment.expiresAt)) {
    const saved = getPayment(id);
    if (saved) {
      updatePayment(id, { status: 'expired', expiredAt: Date.now() });
      return getPayment(id);
    }
    return { ...payment, status: 'expired', expiredAt: Date.now() };
  }

  if (payment.status === 'pending' && liveCheck) {
    payment = await tryMatchByHistory(payment);
    if (payment.status === 'pending') expireOldPayments();
    const persisted = getPayment(id);
    if (persisted) payment = persisted;
  }

  return payment;
}

export function listPaymentHistory(limit = 50) {
  expireOldPayments();
  return allPayments(limit);
}

export async function listWebPaymentHistory(limit = 50) {
  expireOldPayments();
  const rows = allPayments(limit, { includeQrisString: true });
  return Promise.all(rows.map(async (payment) => {
    const qrisString = payment.qrisString;
    delete payment.qrisString;

    // The web UI needs the QR only for pending history entries so an older
    // pending payment can be selected again. API-created payments share this store.
    if (payment.status === 'pending' && qrisString) {
      try {
        payment.qr = await qrisDataUrl(qrisString);
      } catch (error) {
        console.warn(`[Gateway] Gagal membuat ulang QR untuk ${payment.id}:`, error.message);
        payment.qr = null;
      }
    } else {
      payment.qr = null;
    }

    return payment;
  }));
}

export async function cancelPayment(id, { paymentToken = null } = {}) {
  expireOldPayments();
  let payment = getPayment(id);

  if (!payment && paymentToken) {
    const proof = verifyPaymentToken(paymentToken, id);
    if (proof) {
      // Check GoBiz first so a payment that already landed is not presented
      // as successfully cancelled.
      payment = await getPaymentStatus(id, { liveCheck: true, paymentToken });
    }
  }

  if (!payment) return null;
  if (payment.status !== 'pending') {
    return { payment, cancelled: false };
  }

  const saved = getPayment(id);
  if (!saved) {
    return {
      payment: { ...payment, status: 'cancelled', cancelledAt: Date.now() },
      cancelled: true,
      ephemeral: true
    };
  }

  const updated = updatePayment(id, {
    status: 'cancelled',
    cancelledAt: Date.now()
  });
  return { payment: updated, cancelled: true, ephemeral: false };
}

export async function startWatcher() {
  if (watcherStarted || process.env.VERCEL) return;
  watcherStarted = true;

  const merchant = getMerchant();
  watcherInstance = new GoPayWatcher(merchant, WATCHER_INTERVAL);
  watcherInstance.on('payment', async (data) => {
    try {
      expireOldPayments();
      await matchTransaction(data);
    } catch (error) {
      console.error('[Gateway] Gagal memproses transaksi baru:', error.message);
    }
  });

  await watcherInstance._poll();
  watcherInstance._timer = setInterval(() => watcherInstance._poll(), WATCHER_INTERVAL);
  console.log(`[Gateway] Background watcher aktif setiap ${WATCHER_INTERVAL} ms.`);
}

async function matchTransaction(data) {
  const amount = getTransactionAmount(data?.entry?.raw || {}, data?.entry);
  if (!Number.isFinite(amount)) return;

  const raw = data?.entry?.raw || {};
  const txTime = getTransactionTimestamp(raw) || Date.now();
  const candidates = getPendingPayments()
    .filter((p) => Number(p.amount) === amount)
    .filter((p) => txTime >= Number(p.createdAt) - 30_000)
    .filter((p) => txTime <= Number(p.expiresAt) + 120_000)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

  if (!candidates.length) return;
  if (!isSuccessfulPayment(raw)) return;

  const target = candidates[0];
  const txId = getTransactionId(raw) || String(data?.txId || `${txTime}_${amount}`);
  updatePayment(target.id, {
    status: 'paid',
    paidAt: Date.now(),
    transactionId: txId,
    transaction: safeTransaction(raw)
  });
  console.log(`[Gateway] Payment ${target.id} terkonfirmasi: Rp ${amount.toLocaleString('id-ID')} / ${txId}`);
}

async function tryMatchByHistory(payment) {
  try {
    const result = await getMerchant().getHistory({ days: 2, size: HISTORY_QUERY_SIZE });
    const diagnostics = result?.diagnostics || {};
    const histories = result?.data?.histories || [];
    lastStatusDiagnostics = {
      at: Date.now(),
      paymentId: payment.id,
      amount: Number(payment.amount),
      historyCount: histories.length,
      analyticsCount: Number(diagnostics.analyticsCount || 0),
      journalCount: Number(diagnostics.journalCount || 0),
      analyticsError: diagnostics.analyticsError || null,
      journalError: diagnostics.journalError || null,
      candidatesByAmount: 0,
      successfulCandidates: 0,
      matched: false
    };

    const paymentCreated = Number(payment.createdAt);
    const paymentExpires = Number(payment.expiresAt);
    const rows = histories.map((entry) => ({ entry, raw: entry?.raw || {} }))
      .filter(({ entry }) => !entry?.type || entry.type === 'payin')
      .map(({ entry, raw }) => {
        const amount = getTransactionAmount(raw, entry);
        const txTime = getTransactionTimestamp(raw) || parseHistoryTime(entry?.time);
        const statuses = getStatusValues(raw);
        const successful = isSuccessfulPayment(raw);
        const inWindow = !txTime || (txTime >= paymentCreated - 120_000 && txTime <= paymentExpires + 120_000);
        return { entry, raw, amount, txTime, statuses, successful, inWindow };
      });

    const amountRows = rows.filter((item) => Number.isFinite(item.amount) && item.amount === Number(payment.amount));
    const successfulRows = amountRows.filter((item) => item.successful);
    lastStatusDiagnostics.candidatesByAmount = amountRows.length;
    lastStatusDiagnostics.successfulCandidates = successfulRows.length;

    // IMPORTANT: never use an older successful transaction merely because the
    // nominal is identical. A status check is only allowed to match a GoBiz
    // transaction whose timestamp belongs to this payment's lifetime.
    // If GoBiz does not expose a parseable timestamp, we cannot safely prove
    // that a same-amount transaction belongs to this payment, so leave it
    // pending instead of marking it paid by mistake.
    const windowStart = paymentCreated - 30_000;
    const windowEnd = Math.min(paymentExpires + 120_000, Date.now() + 120_000);
    const usedTransactionIds = new Set(
      allPayments(500)
        .filter((item) => item.id !== payment.id && item.status === 'paid' && item.transactionId)
        .map((item) => String(item.transactionId))
    );

    const matches = successfulRows
      .filter((item) => Number.isFinite(item.txTime))
      .filter((item) => item.txTime >= windowStart && item.txTime <= windowEnd)
      .map((item) => ({
        ...item,
        txId: getTransactionId(item.raw) || `${item.txTime}_${item.amount}`
      }))
      .filter((item) => !usedTransactionIds.has(String(item.txId)))
      .sort((a, b) => Number(a.txTime) - Number(b.txTime));

    const match = matches[0];
    if (!match) {
      lastStatusDiagnostics.sampleStatuses = amountRows.slice(0, 5).map((x) => x.statuses);
      lastStatusDiagnostics.rejectedOldAmountMatches = successfulRows.filter((item) =>
        !Number.isFinite(item.txTime) || item.txTime < windowStart || item.txTime > windowEnd
      ).length;
      lastStatusDiagnostics.rejectedAlreadyUsedTransactions = successfulRows.filter((item) => {
        const txId = getTransactionId(item.raw) || (Number.isFinite(item.txTime) ? `${item.txTime}_${item.amount}` : null);
        return txId && usedTransactionIds.has(String(txId));
      }).length;
      return payment;
    }

    const txId = String(match.txId);
    const update = {
      status: 'paid',
      paidAt: Date.now(),
      transactionId: String(txId),
      transaction: safeTransaction(match.raw),
      statusCheck: { ...lastStatusDiagnostics, matched: true }
    };
    lastStatusDiagnostics.matched = true;

    if (getPayment(payment.id)) {
      updatePayment(payment.id, update);
      console.log(`[Gateway] Live status: ${payment.id} => PAID (${txId})`);
      return getPayment(payment.id);
    }

    console.log(`[Gateway] Live status: ${payment.id} => PAID (${txId}) [stateless]`);
    return { ...payment, ...update };
  } catch (error) {
    lastStatusDiagnostics = {
      at: Date.now(), paymentId: payment.id, amount: Number(payment.amount),
      historyCount: 0, analyticsCount: 0, journalCount: 0,
      analyticsError: null, journalError: null, candidatesByAmount: 0,
      successfulCandidates: 0, matched: false, error: error.message || String(error)
    };
    console.warn('[Gateway] Live status check gagal:', error.message);
    return { ...payment, statusCheck: lastStatusDiagnostics };
  }
}

export function getLastStatusDiagnostics() {
  return lastStatusDiagnostics;
}

function parseHistoryTime(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function nestedTransaction(raw) {
  const nested = raw?.metadata?.transaction;
  return nested && typeof nested === 'object' ? nested : {};
}

function getTransactionAmount(raw, entry = null) {
  const tx = nestedTransaction(raw);
  const grossAmount = raw?.gross_amount ?? tx?.gross_amount;
  if (grossAmount != null) {
    const n = Number(grossAmount);
    if (Number.isFinite(n) && n > 0) return n / 100;
  }

  const directAmount = raw?.amount ?? tx?.amount;
  if (directAmount != null) {
    const n = Number(directAmount);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const text = String(entry?.amount?.displayed_text || '').replace(/[^0-9]/g, '');
  const fallback = Number(text || 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : NaN;
}

function getTransactionTimestamp(raw) {
  const tx = nestedTransaction(raw);
  const candidate = raw?.transaction_time
    ?? tx?.transaction_time
    ?? raw?.created_at
    ?? tx?.created_at
    ?? raw?.updated_at
    ?? tx?.updated_at;
  if (candidate == null) return null;

  if (typeof candidate === 'number' || /^\d+(?:\.\d+)?$/.test(String(candidate).trim())) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric)) return null;
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(String(candidate));
  return Number.isFinite(parsed) ? parsed : null;
}

function getTransactionId(raw) {
  const tx = nestedTransaction(raw);
  const candidate = raw?.transaction_id
    ?? raw?.transactionId
    ?? raw?.id
    ?? raw?.order_id
    ?? tx?.transaction_id
    ?? tx?.transactionId
    ?? tx?.id
    ?? tx?.order_id;
  return candidate == null ? null : String(candidate);
}

function getStatusValues(raw) {
  const tx = nestedTransaction(raw);
  return [
    raw?.status,
    raw?.transaction_status,
    raw?.payment_status,
    raw?.paymentStatus,
    raw?.state,
    tx?.status,
    tx?.transaction_status,
    tx?.payment_status,
    tx?.paymentStatus,
    tx?.state
  ]
    .filter((value) => value != null && String(value).trim() !== '')
    .map((value) => String(value).trim().toLowerCase());
}

function isSuccessfulPayment(raw) {
  const statuses = getStatusValues(raw);
  if (!statuses.length) return true;

  // GoBiz/payment payloads can use several success labels depending on the
  // endpoint/version. Explicit failure/pending states always win.
  const failed = new Set([
    'failed', 'fail', 'error', 'rejected', 'reject', 'declined',
    'cancelled', 'canceled', 'void', 'voided', 'expired', 'pending',
    'created', 'initiated', 'refunded', 'refund', 'reversed'
  ]);
  const success = new Set([
    'settlement', 'settled', 'capture', 'captured', 'success',
    'successful', 'paid', 'completed', 'complete', 'done', 'succeeded'
  ]);

  if (statuses.some((status) => failed.has(status))) return false;
  if (statuses.some((status) => success.has(status))) return true;

  // Unknown status values should not block an otherwise valid pay-in history.
  return true;
}

function safeTransaction(raw) {
  const clone = structuredClone(raw || {});
  for (const key of ['authorization', 'access_token', 'refresh_token', 'token']) {
    if (key in clone) clone[key] = '[redacted]';
  }
  return clone;
}

export async function initGateway() {
  if (!process.env.VERCEL) {
    await startWatcher();
  }
}

export const PAYMENT_TTL_MINUTES = PAYMENT_TTL_MS / 60_000;
