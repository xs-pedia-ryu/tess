# GoBiz QRIS Web Gateway

Web UI + REST API yang membungkus modul GoBiz yang diberikan.

## Fitur versi terbaru

- UI HTML/CSS/JS sederhana dan responsif.
- Tombol **API Docs** menuju `/docs`.
- Create QRIS: `POST /api/payments` dan server-to-server `POST /api/v1/payments`.
- Cek status otomatis tiap 5 detik pada UI.
- Tombol **Cek Status Manual** yang memaksa one-shot history check (`?refresh=1`).
- Cancel QR: `POST /api/payments/:id/cancel` dan `/api/v1/payments/:id/cancel`.
- QRIS **fixed 15 menit** (900000 ms).
- Perbaikan pembentukan QRIS: field nominal `54` top-level dibuat tepat satu, termasuk memperbaiki payload lama yang memiliki `54` ganda.
- Spasi yang bermakna di dalam field QRIS (misalnya padding nama merchant) **tidak dihapus**, karena dapat mengubah panjang TLV dan merusak QR.
- CRC QRIS dihitung ulang setelah payload diubah.
- Railway: background watcher untuk deteksi transaksi mendekati realtime.
- Vercel: status tetap bisa dicek on-demand; tidak mengandalkan worker background permanen.
- `.gopay_cache.json` dibuat otomatis oleh modul GoBiz dan bisa diarahkan ke Railway Volume.

## Deploy Railway

1. Push folder ini ke GitHub.
2. Di Railway, buat service dari repo tersebut.
3. Set variables:

```text
GOPAY_LOGIN_METHOD=password
GOPAY_EMAIL=...
GOPAY_PASSWORD=...
QRIS_STRING=...
API_KEY=buat-api-key-random
DATA_DIR=/app/data
GOPAY_CACHE_FILE=/app/data/.gopay_cache.json
PAYMENT_STORE_FILE=/app/data/payments.json
WATCHER_INTERVAL_MS=5000
```

4. Mount Railway Volume ke `/app/data` agar cache/token dan payment store tetap tersimpan melewati restart/deploy.
5. Start command:

```bash
npm start
```

## Deploy Vercel

Project memakai Express. Vercel dapat melayani request API, tetapi tidak cocok untuk worker polling permanen. Untuk alur yang bergantung pada watcher, Railway lebih sesuai.

Variables Vercel menggunakan nama yang sama. Filesystem Vercel tidak dipakai sebagai storage permanen; gunakan database/storage eksternal bila membutuhkan persistence di Vercel.

## API

Public API base URL:

```text
https://xspedia-payment.vercel.app
```

Alamat tersebut adalah **web/API gateway**. Backend gateway tetap menggunakan **GoBiz** dari module yang disertakan di project, bukan XSPedia sebagai provider pembayaran.

Endpoint `/api/v1/*` sekarang **tidak membutuhkan API key**.

### Create

```http
POST https://xspedia-payment.vercel.app/api/v1/payments
Content-Type: application/json
```

```json
{"amount":50000}
```

### Status

```http
POST https://xspedia-payment.vercel.app/api/v1/payments/{paymentId}/status
Content-Type: application/json
```

Request body:

```json
{
}
```

### Cancel

```http
POST https://xspedia-payment.vercel.app/api/v1/payments/{paymentId}/cancel
x-payment-token: YOUR_PAYMENT_TOKEN
```

### History

```http
GET https://xspedia-payment.vercel.app/api/v1/payments/history?limit=50
```

Dokumentasi lengkap tersedia di `/docs`.

### ID transaksi

- Web: `xiao-web-123456`
- API: `xiao-api-123456`

### Status

- `pending`: menunggu pembayaran.
- `paid`: pembayaran terdeteksi dari GoBiz.
- `expired`: QRIS lewat 15 menit.
- `cancelled`: sesi gateway dibatalkan.

### Catatan API publik

Create, status, cancel, dan history pada `/api/v1/*` tidak menggunakan API key. Status dan cancel pada API publik tidak menggunakan `paymentToken`; cukup gunakan `paymentId`.

## Catatan token

Modul GoBiz yang diberikan menyimpan token di `.gopay_cache.json` dan akan login ulang saat token invalid/401 sesuai implementasi yang ada. Untuk deployment unattended, email/password lebih praktis daripada OTP terminal kecuali kamu punya callback OTP eksternal.

Jangan commit `.env`, token, password, atau `.gopay_cache.json` ke GitHub.

## ID transaksi gateway

Request dari halaman web menghasilkan ID dengan format `xiao-web-123456`.
Request melalui API `/api/v1/*` menghasilkan ID dengan format `xiao-api-123456`. Angka terakhir adalah 6 digit acak.

## Polling status

Halaman web melakukan pengecekan status aktif setiap 5 detik selama pembayaran masih `pending`. Setelah `paid`, `expired`, atau `cancelled`, polling dihentikan dan riwayat diperbarui otomatis.

Endpoint history: `GET /api/payments/history` untuk web dan `GET /api/v1/payments/history` untuk API.


### Status pembayaran

Versi ini mengecek **Analytics dan Journal GoBiz sekaligus**. Ini penting karena transaksi QRIS dapat muncul di Journal lebih dulu atau tidak muncul pada hasil Analytics yang sama. API publik `/api/v1/*` menggunakan `paymentId` saja untuk status/cancel.

Endpoint status melakukan live-check ke riwayat GoBiz untuk pembayaran yang masih pending. UI melakukan pengecekan otomatis setiap 5 detik. Label sukses menerima variasi status seperti `success`, `successful`, `paid`, `completed`, `settlement`, dan `capture`, sehingga pembayaran yang sudah terlihat masuk tidak berhenti di status MENUNGGU.


## UI/status update (v5)
- QRIS/status card is hidden until a payment is actually created.
- Browser checks payment status every 5 seconds.
- Status endpoint performs a live GoBiz history check for pending payments on both Railway and Vercel.
- Successful payment detection accepts common success labels including `success`, `successful`, `paid`, `completed`, `settlement`, and `capture`.
- Status, countdown, and action buttons are compact so the QR page uses less vertical space.


## Penting untuk Vercel

API publik tidak mengekspos `paymentToken`. Untuk endpoint publik status/cancel, gunakan `paymentId`. Mekanisme token internal masih tersedia untuk kompatibilitas halaman web lama, tetapi bukan bagian dari kontrak API publik.

History browser juga disimpan di `localStorage`, sehingga riwayat pada halaman web tidak hilang hanya karena request berikutnya masuk ke instance Vercel yang berbeda.

### Batas cancel

Endpoint cancel membatalkan **sesi gateway**. Ini tidak membatalkan/refund transaksi GoBiz yang sudah `paid`/settlement. Jika pembayaran sudah masuk sebelum cancel, endpoint akan menolak pembatalan.

## v6 — perbaikan status/cancel pada Vercel

Jika status API publik menampilkan `Payment ID tidak ditemukan`, pastikan storage pembayaran tersedia pada instance/storage yang menerima request. API publik sengaja tidak menggunakan `paymentToken`.

Untuk produksi, set `PAYMENT_SIGNING_SECRET` ke secret acak yang stabil di seluruh environment. Jika variabel ini kosong, kode memakai fallback secret dari environment yang sudah tersedia.

Cancel tetap merupakan **cancel sesi gateway**. Kode tidak mengklaim membatalkan transaksi GoBiz yang sudah settlement.

### Vercel: gunakan token GoBiz yang sudah dimiliki

Jika deployment memakai access token GoBiz yang sudah berhasil dipakai pada script lama, isi:

```env
GOPAY_TOKEN=TOKEN_GO_BIZ_KAMU
GOPAY_MERCHANT_ID=MERCHANT_ID_KAMU
```

`GOPAY_TOKEN` diprioritaskan sebelum cache lokal. Ini penting karena filesystem Vercel bersifat ephemeral. Jika token sudah tidak valid, backend akan mencoba login ulang menggunakan `GOPAY_EMAIL` + `GOPAY_PASSWORD` bila keduanya tersedia.

> Catatan status: endpoint GoBiz membatasi parameter `size` maksimal 100. Gateway otomatis menurunkan nilai yang lebih besar ke 100 agar tidak mendapat HTTP 422.
