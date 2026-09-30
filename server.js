import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQrPayment, getPaymentStatus, cancelPayment, listPaymentHistory, listWebPaymentHistory, initGateway, getLastStatusDiagnostics } from './payment-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

function requireApiKey(req, res, next) {
  const configured = String(process.env.API_KEY || '').trim();
  if (!configured) {
    return res.status(503).json({ success: false, error: 'Server-to-server API belum diaktifkan. Set API_KEY di environment.' });
  }

  const supplied = String(req.get('x-api-key') || '');
  if (supplied !== configured) {
    return res.status(401).json({ success: false, error: 'API key tidak valid.' });
  }

  next();
}

function allowedOrigin(origin) {
  if (!origin) return true;
  const list = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length) return true;
  return list.includes(origin);
}

function isLiveStatusRequest(_req) {
  // Status endpoints are used by the 5-second client poller. Always allow a live
  // GoBiz history check so the gateway can confirm a payment on Railway or Vercel.
  return true;
}

function paymentResponse(payment, { includeToken = true } = {}) {
  const data = {
    paymentId: payment.id,
    amount: payment.amount,
    status: payment.status,
    createdAt: payment.createdAt,
    expiresAt: payment.expiresAt,
    expiresInMs: Math.max(0, Number(payment.expiresAt) - Date.now()),
    qr: payment.qr,
    qrisString: payment.qrisString
  };
  if (includeToken && payment.paymentToken) data.paymentToken = payment.paymentToken;
  return data;
}

function getPaymentToken(req) {
  return String(req.get('x-payment-token') || req.query?.token || req.body?.paymentToken || '').trim() || null;
}

app.use(cors({
  origin(origin, callback) {
    callback(null, allowedOrigin(origin));
  }
}));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'gobiz-qris-web-gateway', time: new Date().toISOString() });
});

app.post('/api/payments', async (req, res) => {
  try {
    const payment = await createQrPayment(req.body?.amount, { source: 'web' });
    res.status(201).json({ success: true, data: paymentResponse(payment) });
  } catch (error) {
    console.error('[API] create payment:', error);
    res.status(400).json({ success: false, error: error.message || 'Gagal membuat pembayaran.' });
  }
});

app.get('/api/payments/history', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    res.json({ success: true, data: await listWebPaymentHistory(limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Gagal mengambil history pembayaran.' });
  }
});

app.get('/api/payments/:id/status', async (req, res) => {
  try {
    const payment = await getPaymentStatus(req.params.id, { liveCheck: isLiveStatusRequest(req), paymentToken: getPaymentToken(req) });
    if (!payment) return res.status(404).json({ success: false, error: 'Sesi pembayaran tidak ditemukan atau token sesi tidak valid. Buat QRIS baru.' });
    res.json({ success: true, data: payment });
  } catch (error) {
    console.error('[API] payment status:', error);
    res.status(500).json({ success: false, error: error.message || 'Gagal mengecek status pembayaran.' });
  }
});

app.post('/api/payments/:id/cancel', async (req, res) => {
  try {
    const result = await cancelPayment(req.params.id, { paymentToken: getPaymentToken(req) });
    if (!result) return res.status(404).json({ success: false, error: 'Payment ID tidak ditemukan.' });
    if (!result.cancelled) {
      return res.status(409).json({
        success: false,
        error: `Pembayaran tidak dapat dibatalkan karena status saat ini adalah ${result.payment.status}.`,
        data: result.payment
      });
    }
    res.json({ success: true, data: result.payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Gagal membatalkan pembayaran.' });
  }
});

app.get('/api/payments/:id/status-debug', async (req, res) => {
  try {
    const payment = await getPaymentStatus(req.params.id, { liveCheck: true, paymentToken: getPaymentToken(req) });
    res.json({ success: true, data: { payment, diagnostics: getLastStatusDiagnostics() } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Gagal debug status.' });
  }
});

app.get('/docs', (_req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

app.get('/api/docs', (_req, res) => {
  res.redirect('/docs');
});

app.post('/api/v1/payments', async (req, res) => {
  try {
    const payment = await createQrPayment(req.body?.amount, { source: 'api' });
    // Public API never exposes or requires paymentToken.
    res.status(201).json({ success: true, data: paymentResponse(payment, { includeToken: false }) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Gagal membuat pembayaran.' });
  }
});

app.get('/api/v1/payments/history', (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    res.json({ success: true, data: listPaymentHistory(limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Gagal mengambil history pembayaran.' });
  }
});

app.post('/api/v1/payments/:id/status', async (req, res) => {
  try {
    // Public API status is identified only by paymentId. No API key or paymentToken.
    const payment = await getPaymentStatus(req.params.id, { liveCheck: true });
    if (!payment) return res.status(404).json({ success: false, error: 'Payment ID tidak ditemukan atau pembayaran sudah tidak tersedia.' });
    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Gagal mengecek status pembayaran.' });
  }
});

app.post('/api/v1/payments/:id/cancel', async (req, res) => {
  try {
    // Public API cancel is identified only by paymentId. No API key or paymentToken.
    const result = await cancelPayment(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'Payment ID tidak ditemukan.' });
    if (!result.cancelled) {
      return res.status(409).json({
        success: false,
        error: `Pembayaran tidak dapat dibatalkan karena status saat ini adalah ${result.payment.status}.`,
        data: result.payment
      });
    }
    res.json({ success: true, data: result.payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Gagal membatalkan pembayaran.' });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\nGoBiz QRIS Web Gateway listening on http://0.0.0.0:${PORT}`);
    try {
      await initGateway();
    } catch (error) {
      console.error('[Gateway] Init warning:', error.message);
    }
  });
}

export default app;
