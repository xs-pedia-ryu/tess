# API Documentation — GoBiz QRIS Web Gateway

Base URL:

```text
https://xspedia-payment.vercel.app
```

> Domain di atas adalah alamat **web/API gateway**. Backend project ini tetap menggunakan modul **GoBiz** yang disertakan di ZIP untuk membuat QRIS dan membaca status pembayaran. Nama domain tidak mengubah provider backend.

Semua QRIS baru berlaku **15 menit (900000 ms)** sejak payment dibuat.

## 1. Health check

```http
GET https://xspedia-payment.vercel.app/api/health
```

## 2. Create QRIS

Endpoint API publik:

```http
POST https://xspedia-payment.vercel.app/api/v1/payments
Content-Type: application/json
```

**Tidak memerlukan API key.**

Request:

```json
{
  "amount": 50000
}
```

Contoh:

```bash
curl -X POST \
  "https://xspedia-payment.vercel.app/api/v1/payments" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000}'
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "paymentId": "xiao-api-123456",
    "amount": 50000,
    "status": "pending",
    "createdAt": 1788058800000,
    "expiresAt": 1788059700000,
    "expiresInMs": 900000,
    "qr": "data:image/png;base64,...",
    "qrisString": "000201..."
  }
}
```

Untuk halaman web gateway, ID dibuat dengan format `xiao-web-6digit`. Untuk request API, ID dibuat dengan format `xiao-api-6digit`.

**Tidak ada `paymentToken` untuk API publik.** Simpan `paymentId` dari response Create dan gunakan ID tersebut untuk status/cancel.

## 3. Cek status QRIS

```http
POST https://xspedia-payment.vercel.app/api/v1/payments/{paymentId}/status
Content-Type: application/json
```

**Tidak memerlukan API key dan tidak menggunakan `paymentToken`.**

Cukup gunakan `paymentId` yang didapat dari response Create. `paymentId` sudah berada di URL endpoint. Body boleh kosong. Gateway melakukan live-check transaksi **GoBiz** saat endpoint status dipanggil.

Contoh:

```bash
curl -X POST \
  "https://xspedia-payment.vercel.app/api/v1/payments/xiao-api-123456/status" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response pending:

```json
{
  "success": true,
  "data": {
    "id": "xiao-api-123456",
    "amount": 50000,
    "status": "pending",
    "createdAt": 1788058800000,
    "expiresAt": 1788059700000,
    "paidAt": null,
    "transactionId": null
  }
}
```

Response paid:

```json
{
  "success": true,
  "data": {
    "id": "xiao-api-123456",
    "amount": 50000,
    "status": "paid",
    "createdAt": 1788058800000,
    "expiresAt": 1788059700000,
    "paidAt": 1788058865000,
    "transactionId": "TX-123456"
  }
}
```

Response expired:

```json
{
  "success": true,
  "data": {
    "id": "xiao-api-123456",
    "amount": 50000,
    "status": "expired",
    "createdAt": 1788058800000,
    "expiresAt": 1788059700000,
    "paidAt": null,
    "transactionId": null,
    "expiredAt": 1788059701000
  }
}
```

## 4. Cancel QRIS

```http
POST https://xspedia-payment.vercel.app/api/v1/payments/{paymentId}/cancel
Content-Type: application/json
```

**Tidak memerlukan API key dan tidak menggunakan `paymentToken`.**

Contoh:

```bash
curl -X POST \
  "https://xspedia-payment.vercel.app/api/v1/payments/xiao-api-123456/cancel" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response `200` jika masih pending:

```json
{
  "success": true,
  "data": {
    "id": "xiao-api-123456",
    "amount": 50000,
    "status": "cancelled",
    "cancelledAt": 1788058900000
  }
}
```

Jika sudah `paid`, `expired`, atau `cancelled`, server mengembalikan `409`.

**Cancel adalah pembatalan sesi gateway.** Ini tidak membatalkan/refund transaksi GoBiz yang sudah berhasil atau settlement.

## 5. History

```http
GET https://xspedia-payment.vercel.app/api/v1/payments/history?limit=50
```

**Tidak memerlukan API key.**

Contoh:

```bash
curl \
  "https://xspedia-payment.vercel.app/api/v1/payments/history?limit=50"
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "xiao-api-123456",
      "amount": 50000,
      "status": "paid",
      "createdAt": 1788058800000,
      "expiresAt": 1788059700000,
      "paidAt": 1788058865000,
      "transactionId": "TX-123456",
      "source": "api"
    }
  ]
}
```

## 6. Contoh integrasi website

Create QRIS:

```js
const base = "https://xspedia-payment.vercel.app";

const createdResponse = await fetch(`${base}/api/v1/payments`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ amount: 50000 })
});

const created = await createdResponse.json();
const paymentId = created.data.paymentId;

console.log(paymentId);
```

Cek status tanpa token:

```js
const statusResponse = await fetch(
  `${base}/api/v1/payments/${paymentId}/status`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  }
);

const status = await statusResponse.json();
console.log(status.data.status);
```

Pengecekan otomatis setiap 5 detik:

```js
const timer = setInterval(async () => {
  const response = await fetch(
    `${base}/api/v1/payments/${paymentId}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );

  const result = await response.json();
  console.log(result.data.status);

  if (["paid", "expired", "cancelled"].includes(result.data.status)) {
    clearInterval(timer);
  }
}, 5000);
```

> Catatan deployment: status berdasarkan `paymentId` membutuhkan data pembayaran tersedia pada instance/storage yang menerima request. API publik sengaja tidak memakai `paymentToken`.
