import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const STORE_FILE = process.env.PAYMENT_STORE_FILE
  ? path.resolve(process.env.PAYMENT_STORE_FILE)
  : path.join(DATA_DIR, 'payments.json');

let memory = {};
let fileWritable = true;

function ensureStoreFile() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, '{}', 'utf8');
    return true;
  } catch {
    fileWritable = false;
    return false;
  }
}

function load() {
  if (fileWritable && ensureStoreFile()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') memory = parsed;
    } catch {
      // Keep in-memory store if the persisted file is unavailable/corrupt.
    }
  }
  return memory;
}

function save() {
  if (!fileWritable || !ensureStoreFile()) return;
  try {
    const tmp = `${STORE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(memory, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch {
    fileWritable = false;
  }
}

load();

export function makePaymentId(source = 'web') {
  const prefix = source === 'api' ? 'xiao-api' : 'xiao-web';
  let id;
  do {
    const random = crypto.randomInt(100000, 1000000);
    id = `${prefix}-${random}`;
  } while (memory[id]);
  return id;
}

export function createPayment({ amount, createdAt, expiresAt, qrisString, source = 'web' }) {
  const id = makePaymentId(source);
  memory[id] = {
    id,
    amount: Number(amount),
    createdAt,
    expiresAt,
    status: 'pending',
    paidAt: null,
    transactionId: null,
    source,
    qrisString
  };
  save();
  return sanitize(memory[id]);
}

export function getPayment(id, options = {}) {
  return memory[id] ? sanitize(memory[id], options) : null;
}

export function updatePayment(id, patch) {
  if (!memory[id]) return null;
  memory[id] = { ...memory[id], ...patch };
  save();
  return sanitize(memory[id]);
}

export function getPendingPayments() {
  const now = Date.now();
  return Object.values(memory).filter((p) => p.status === 'pending' && Number(p.expiresAt) > now);
}

export function expireOldPayments() {
  const now = Date.now();
  let changed = false;
  for (const payment of Object.values(memory)) {
    if (payment.status === 'pending' && Number(payment.expiresAt) <= now) {
      payment.status = 'expired';
      changed = true;
    }
  }
  if (changed) save();
}

export function allPayments(limit = 50, options = {}) {
  return Object.values(memory)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, Math.max(1, Number(limit) || 50))
    .map((payment) => sanitize(payment, options));
}

function sanitize(payment, options = {}) {
  if (!payment) return null;
  const { includeQrisString = false } = options;
  const { qrisString, ...safe } = payment;
  return includeQrisString ? { ...safe, qrisString } : safe;
}

