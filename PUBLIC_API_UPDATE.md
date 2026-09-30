# Public API update

## v1.8.2
- Web history refreshes every 5 seconds.
- Pending payments created through the public API appear in the web history.
- Clicking a pending history item replaces the currently displayed QR with that payment QR and immediately checks its status.
- The web history can regenerate QR images from stored dynamic QRIS strings for pending payments.

## v1.8.1
- Removed `paymentToken` from public `/api/v1/*` create responses.
- Public status and cancel use `paymentId` only.
- Status remains `POST /api/v1/payments/{paymentId}/status`.
- Cancel remains `POST /api/v1/payments/{paymentId}/cancel`.
- No API key is required for public endpoints.

This upgrade is based on `gobiz-qris-web-gateway-v11`.

The public API examples use:

`https://xspedia-payment.vercel.app`

The implementation remains **GoBiz**. The domain is only the address clients use to reach this gateway.

These `/api/v1/*` endpoints are public and do not require `x-api-key`:

- `POST /api/v1/payments`
- `POST /api/v1/payments/{paymentId}/status`
- `POST /api/v1/payments/{paymentId}/cancel`
- `GET /api/v1/payments/history`

Public status/cancel no longer use or expose `paymentToken`; they use `paymentId` only.

Version 1.8.0 also updates the visual `/docs` page so every public API curl example uses `https://xspedia-payment.vercel.app` and contains no `x-api-key` header.
