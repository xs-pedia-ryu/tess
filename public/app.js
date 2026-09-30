const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'xiao_qris_current_payment_v7';
const HISTORY_KEY = 'xiao_qris_history_v7';
const HISTORY_REFRESH_MS = 5000;
const state = {
  paymentId: null,
  createdAt: null,
  expiresAt: null,
  amount: null,
  qr: null,
  lastStatus: null,
  historyTimer: null,
  historyChecking: false,
  checking: false,
  historyItems: []
};

function rupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'short', timeStyle: 'medium' })
    .format(new Date(Number(value)));
}

function showMessage(message, type = 'error') {
  const el = $('message');
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `message ${type}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function localHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveLocalHistory(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50))); } catch {}
}

function upsertLocalHistory(payment) {
  if (!payment?.id) return;
  const items = localHistory().filter((x) => x.id !== payment.id);
  items.unshift({
    id: payment.id,
    amount: Number(payment.amount),
    createdAt: Number(payment.createdAt),
    expiresAt: Number(payment.expiresAt),
    status: payment.status || 'pending',
    paidAt: payment.paidAt || null,
    cancelledAt: payment.cancelledAt || null,
    transactionId: payment.transactionId || null,
    qr: payment.qr || null
  });
  saveLocalHistory(items);
}

function mergeHistory(local, server) {
  const map = new Map();
  for (const item of [...server, ...local]) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    map.set(item.id, prev
      ? { ...prev, ...item, qr: item.qr || prev.qr || null }
      : item);
  }
  return [...map.values()]
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 50);
}

function renderHistory(items) {
  const list = $('historyList');
  const empty = $('historyEmpty');
  const rows = mergeHistory([], items || []);
  state.historyItems = rows;

  if (!rows.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = rows.map((p) => {
    const status = p.status || 'pending';
    const statusLabel = status === 'paid' ? 'BERHASIL'
      : status === 'expired' ? 'EXPIRED'
      : status === 'cancelled' ? 'DIBATALKAN' : 'MENUNGGU';
    const transaction = p.transactionId
      ? `<div class="history-sub">TRX: ${escapeHtml(p.transactionId)}</div>` : '';
    const clickable = status === 'pending' && p.qr;
    return `<button type="button" class="history-item ${clickable ? 'history-clickable' : ''} ${state.paymentId === p.id ? 'history-selected' : ''}"
      data-payment-id="${escapeHtml(p.id)}" ${clickable ? '' : 'disabled aria-disabled="true"'}>
      <div class="history-main"><strong>${escapeHtml(p.id)}</strong><span>${rupiah(p.amount)}</span></div>
      <div class="history-main history-secondary"><small>${formatDate(p.createdAt)}</small>
        <span class="history-status ${escapeHtml(status)}">${statusLabel}</span></div>
      ${transaction}
      ${clickable ? '<div class="history-action">Klik untuk tampilkan QRIS</div>' : ''}
    </button>`;
  }).join('');

  list.querySelectorAll('.history-clickable').forEach((el) => {
    el.addEventListener('click', () => selectHistoryPayment(el.dataset.paymentId));
  });
}

async function fetchHistory() {
  const response = await fetch('/api/payments/history?limit=50', { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || 'Gagal mengambil riwayat pembayaran.');
  return Array.isArray(body.data) ? body.data : [];
}

async function refreshPendingStatuses(rows) {
  const pending = rows.filter((p) => p?.status === 'pending').slice(0, 20);
  if (!pending.length) return rows;

  const results = await Promise.allSettled(pending.map(async (p) => {
    const response = await fetch(`/api/v1/payments/${encodeURIComponent(p.id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}), cache: 'no-store'
    });
    const body = await response.json();
    if (!response.ok || !body.success) return null;
    return body.data || null;
  }));

  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value?.id) continue;
    const previous = byId.get(result.value.id) || {};
    byId.set(result.value.id, { ...previous, ...result.value, qr: previous.qr || result.value.qr || null });
  }
  return [...byId.values()];
}

async function loadHistory({ checkPending = true } = {}) {
  if (state.historyChecking) return;
  state.historyChecking = true;
  try {
    let serverRows = await fetchHistory();
    if (checkPending) serverRows = await refreshPendingStatuses(serverRows);
    const combined = mergeHistory(localHistory(), serverRows);
    renderHistory(combined);
    if (state.paymentId) {
      const selected = combined.find((p) => p.id === state.paymentId);
      if (selected) updateSelectedStatus(selected);
    }
  } catch (error) {
    if (!state.historyItems.length) renderHistory(localHistory());
    console.warn('[Gateway Web] history:', error.message);
  } finally {
    state.historyChecking = false;
  }
}

function saveCurrentPayment() {
  if (!state.paymentId) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      paymentId: state.paymentId,
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
      amount: state.amount,
      qr: state.qr,
      lastStatus: state.lastStatus
    }));
  } catch {}
}

function clearCurrentPayment() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function applyPaymentToUI(p) {
  const hasQrProperty = Object.prototype.hasOwnProperty.call(p || {}, 'qr');
  state.paymentId = p.paymentId || p.id || state.paymentId || null;
  state.createdAt = Number(p.createdAt ?? state.createdAt);
  state.expiresAt = Number(p.expiresAt ?? state.expiresAt);
  state.amount = Number(p.amount ?? state.amount);
  if (hasQrProperty) state.qr = p.qr || null;
  state.lastStatus = p.status || state.lastStatus || 'pending';

  $('qrCard').hidden = false;
  $('qr').hidden = !state.qr;
  if (state.qr) $('qr').src = state.qr;
  $('paymentId').textContent = state.paymentId || '-';
  $('paymentAmount').textContent = Number.isFinite(state.amount) ? rupiah(state.amount) : '-';
  $('manualStatusBtn').disabled = !state.paymentId;
  $('cancelBtn').disabled = state.lastStatus !== 'pending';
  setStatus(state.lastStatus);
  updateCountdown();
  saveCurrentPayment();
  upsertLocalHistory({ ...p, id: state.paymentId, amount: state.amount,
    createdAt: state.createdAt, expiresAt: state.expiresAt, status: state.lastStatus, qr: state.qr });
}

function updateSelectedStatus(p) {
  if (!p?.id || p.id !== state.paymentId) return;
  state.lastStatus = p.status || state.lastStatus || 'pending';
  if (p.qr) state.qr = p.qr;
  if (p.amount != null) state.amount = Number(p.amount);
  if (p.createdAt != null) state.createdAt = Number(p.createdAt);
  if (p.expiresAt != null) state.expiresAt = Number(p.expiresAt);
  $('qrCard').hidden = false;
  $('qr').hidden = !state.qr;
  if (state.qr) $('qr').src = state.qr;
  $('paymentId').textContent = state.paymentId;
  $('paymentAmount').textContent = rupiah(state.amount);
  setStatus(state.lastStatus);

  if (state.lastStatus === 'paid') {
    $('statusText').textContent = `Pembayaran berhasil${p.transactionId ? ` • ${p.transactionId}` : ''}`;
    $('cancelBtn').disabled = true;
  } else if (state.lastStatus === 'expired') {
    $('statusText').textContent = 'QRIS telah kedaluwarsa setelah 15 menit.';
    $('cancelBtn').disabled = true;
  } else if (state.lastStatus === 'cancelled') {
    $('statusText').textContent = 'Pembayaran dibatalkan.';
    $('cancelBtn').disabled = true;
  } else {
    $('statusText').textContent = 'Menunggu pembayaran…';
    $('cancelBtn').disabled = false;
  }
  updateCountdown();
  saveCurrentPayment();
}

async function createPayment() {
  const amount = Number($('amount').value);
  if (!Number.isInteger(amount) || amount <= 0) {
    showMessage('Masukkan nominal yang valid.'); return;
  }
  $('createBtn').disabled = true;
  showMessage('');
  state.paymentId = null; state.createdAt = null; state.expiresAt = null;
  state.amount = null; state.qr = null; state.lastStatus = null;
  clearCurrentPayment();
  try {
    const response = await fetch('/api/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || 'Gagal membuat pembayaran.');
    applyPaymentToUI(body.data);
    $('statusText').textContent = 'Menunggu pembayaran…';
    await loadHistory({ checkPending: true });
  } catch (error) {
    showMessage(error.message);
  } finally { $('createBtn').disabled = false; }
}

async function checkStatus(manual = false) {
  if (!state.paymentId || state.checking) return;
  state.checking = true;
  try {
    const response = await fetch(`/api/v1/payments/${encodeURIComponent(state.paymentId)}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}), cache: 'no-store'
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || 'Status tidak dapat dibaca.');
    const p = body.data;
    if (state.qr && !p.qr) p.qr = state.qr;
    applyPaymentToUI(p);
    $('statusText').textContent = p.status === 'paid'
      ? `Pembayaran berhasil${p.transactionId ? ` • ${p.transactionId}` : ''}`
      : p.status === 'expired' ? 'QRIS telah kedaluwarsa setelah 15 menit.'
      : p.status === 'cancelled' ? 'Pembayaran dibatalkan.'
      : manual ? 'Belum ada pembayaran masuk.' : 'Menunggu pembayaran…';
    await loadHistory({ checkPending: false });
  } catch (error) {
    $('statusText').textContent = error.message;
  } finally { state.checking = false; }
}

async function manualCheck() {
  const btn = $('manualStatusBtn');
  btn.disabled = true; btn.textContent = 'Mengecek…';
  await checkStatus(true);
  btn.disabled = !state.paymentId; btn.textContent = '↻ Cek Status';
}

async function cancelCurrentPayment() {
  if (!state.paymentId) return;
  if (!window.confirm('Batalkan QRIS ini?')) return;
  const btn = $('cancelBtn'); btn.disabled = true;
  try {
    const response = await fetch(`/api/v1/payments/${encodeURIComponent(state.paymentId)}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || 'Gagal membatalkan pembayaran.');
    const p = body.data;
    if (state.qr && !p.qr) p.qr = state.qr;
    applyPaymentToUI(p);
    $('statusText').textContent = 'Pembayaran dibatalkan.';
    await loadHistory({ checkPending: false });
  } catch (error) {
    showMessage(error.message); btn.disabled = false;
  }
}

function startHistoryAutoRefresh() {
  if (state.historyTimer) return;
  state.historyTimer = setInterval(() => loadHistory({ checkPending: true }), HISTORY_REFRESH_MS);
}

function selectHistoryPayment(id) {
  const payment = state.historyItems.find((p) => p.id === id);
  if (!payment) return;
  state.paymentId = payment.id;
  state.createdAt = Number(payment.createdAt);
  state.expiresAt = Number(payment.expiresAt);
  state.amount = Number(payment.amount);
  state.qr = payment.qr || null;
  state.lastStatus = payment.status || 'pending';

  $('qrCard').hidden = false;
  $('qr').hidden = !state.qr;
  if (state.qr) $('qr').src = state.qr;
  $('paymentId').textContent = state.paymentId;
  $('paymentAmount').textContent = rupiah(state.amount);
  updateSelectedStatus(payment);
  renderHistory(state.historyItems);
  saveCurrentPayment();
  window.scrollTo({ top: $('qrCard').getBoundingClientRect().top + window.scrollY - 18, behavior: 'smooth' });
  checkStatus(true);
}

function updateCountdown() {
  if (!state.expiresAt) return;
  const left = Math.max(0, Number(state.expiresAt) - Date.now());
  const sec = Math.ceil(left / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  $('countdown').textContent = left > 0 ? `${mm}:${ss}` : '00:00';
  const total = Math.max(1, Number(state.expiresAt) - Number(state.createdAt));
  $('progressBar').style.width = `${Math.min(100, Math.max(0, (left / total) * 100))}%`;
}

function setStatus(status) {
  const el = $('statusPill');
  el.className = `status ${status}`;
  el.textContent = status === 'paid' ? 'BERHASIL'
    : status === 'expired' ? 'EXPIRED'
    : status === 'cancelled' ? 'DIBATALKAN' : 'MENUNGGU';
}

function restoreCurrentPayment() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved?.paymentId) return;
    applyPaymentToUI({ ...saved, id: saved.paymentId, status: saved.lastStatus || 'pending', qr: saved.qr || null });
    checkStatus(false);
  } catch { clearCurrentPayment(); }
}

$('createBtn').addEventListener('click', createPayment);
$('manualStatusBtn').addEventListener('click', manualCheck);
$('cancelBtn').addEventListener('click', cancelCurrentPayment);
$('amount').addEventListener('keydown', (event) => { if (event.key === 'Enter') createPayment(); });

loadHistory({ checkPending: true });
restoreCurrentPayment();
startHistoryAutoRefresh();
setInterval(updateCountdown, 1000);
