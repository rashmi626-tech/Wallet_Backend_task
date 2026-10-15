# VELoop Wallet API Documentation

## Base URL and conventions

The backend listens on `http://localhost:5000` by default and mounts routes at `/`. In the Vite development setup, requests sent to `http://localhost:5173/api` are proxied to the backend with `/api` removed. In the endpoint examples below, `/api` is the client-facing prefix; when calling the backend directly, omit `/api`.

Requests and responses use JSON unless otherwise stated. Send `Content-Type: application/json` with JSON request bodies. Currency is USD; monetary values are integer cents (`2500` means `$25.00`).

Authenticated endpoints require:

```http
Authorization: Bearer <jwt>
```

JWTs expire after 12 hours. Withdrawal and collection requests also use an `Idempotency-Key` header containing 8-100 letters, digits, underscores, hyphens, periods, or colons. Repeating an identical request with the same key returns the original result; reusing a key for a different operation or withdrawal request returns `409`.

The wallet ledger is append-only. For USD, the current `balanceCents` reconciles to the opening balance plus ledger credits minus ledger debits. Every balance-changing operation writes its ledger row in the same MongoDB transaction.

## Common error responses

Errors use this shape:

```json
{
  "message": "A safe, user-facing description."
}
```

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, input, query value, payout selection, or request format |
| `401` | Missing or invalid authentication, or invalid provider signature |
| `403` | Authenticated user lacks required authorization or additional verification is required |
| `404` | Requested account, wallet, withdrawal, or provider operation was not found |
| `409` | Insufficient balance, duplicate/conflicting request, or another resource conflict |
| `500` | Unexpected server error; internal database details are not returned |
| `503` | Required configuration is missing or a balance-changing operation requires MongoDB transactions |

Examples of user-facing messages include `Authentication required.`, `Insufficient balance.`, `Insufficient VEs balance.`, `Selected payout option is unavailable.`, `This payout method is currently unavailable.`, `This withdrawal request has already been submitted.`, and `This request requires additional verification.` A VEs-specific balance message is emitted by the shared validator when called for a VEs debit; there is not currently a VEs debit endpoint.

## Authentication

### Register

**Endpoint:** `/api/auth/register`  
**Method:** `POST`  
**Authentication:** None

**Request:**

```json
{
  "name": "Jordan Example",
  "email": "jordan@example.com",
  "password": "a-strong-password"
}
```

Name must be 2-80 characters, email must be valid, and password must be at least 8 characters. Public registration ignores any role field; new accounts receive the `user` role.

**Response (`201`):**

```json
{
  "token": "<jwt>",
  "user": {
    "name": "Jordan Example",
    "email": "jordan@example.com"
  },
  "wallet": {
    "currency": "USD",
    "balanceCents": 0,
    "ves": 0,
    "sves": 0,
    "gems": 0,
    "tokens": 0,
    "spins": 0
  }
}
```

**Errors:** `400` invalid name, email, or password; `409` account email already exists; `503` JWT secret is missing or shorter than 32 characters; `500` account creation failed.

**Example:**

```bash
curl -X POST http://localhost:5000/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Jordan Example\",\"email\":\"jordan@example.com\",\"password\":\"a-strong-password\"}"
```

### Login

**Endpoint:** `/api/auth/login`  
**Method:** `POST`  
**Authentication:** None

**Request:**

```json
{
  "email": "jordan@example.com",
  "password": "a-strong-password"
}
```

**Response (`200`):** Same `token`, `user`, and `wallet` structure as registration.

**Errors:** `401` email or password is incorrect; `503` JWT secret is missing or shorter than 32 characters.

**Example:**

```bash
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"jordan@example.com\",\"password\":\"a-strong-password\"}"
```

### Current account

**Endpoint:** `/api/auth/me`  
**Method:** `GET`  
**Authentication:** User

**Request:** No body.

The response's `wallet` object includes the daily streak status, upcoming reward, and seven-day reward schedule described below.

**Response (`200`):**

```json
{
  "user": {
    "name": "Jordan Example",
    "email": "jordan@example.com"
  },
  "wallet": {
    "currency": "USD",
    "balanceCents": 12500,
    "ves": 0,
    "sves": 0,
    "gems": 0,
    "tokens": 0,
    "spins": 0
  }
}
```

**Errors:** `401` authentication required; `404` wallet not found; `503` authentication configuration or database is unavailable.

**Example:**

```bash
curl http://localhost:5000/auth/me \
  -H "Authorization: Bearer <jwt>"
```

## Wallet

### Get wallet and recent transactions

**Endpoint:** `/api/wallet`  
**Method:** `GET`  
**Authentication:** User

**Request:** No body.

**Response (`200`):** A `wallet` object (`currency`, `balanceCents`, `ves`, `sves`, `gems`, `tokens`, `spins`, `dailyStreak`, `demoBalanceCents`, `demoActivities`) and up to 10 most recent transaction summaries in `transactions`. `dailyStreak` contains the current and best consecutive-day counts, whether today's UTC reward is claimed, the upcoming reward, and the seven-day reward schedule. `demoBalanceCents` and `demoActivities` relate only to simulated flows and are not real funds or part of the USD ledger.

```json
{
  "wallet": {
    "currency": "USD",
    "balanceCents": 12500,
    "ves": 0,
    "sves": 0,
    "gems": 0,
    "tokens": 0,
    "spins": 0,
    "dailyStreak": {
      "currentDays": 0,
      "bestDays": 0,
      "lastClaimDate": null,
      "claimedToday": false,
      "canClaim": true,
      "nextReward": { "streakDay": 1, "cycleDay": 1, "ves": 50, "spins": 0 },
      "rewardSchedule": [
        { "cycleDay": 1, "ves": 50, "spins": 0 },
        { "cycleDay": 2, "ves": 75, "spins": 0 },
        { "cycleDay": 3, "ves": 100, "spins": 0 },
        { "cycleDay": 4, "ves": 125, "spins": 0 },
        { "cycleDay": 5, "ves": 150, "spins": 0 },
        { "cycleDay": 6, "ves": 200, "spins": 0 },
        { "cycleDay": 7, "ves": 300, "spins": 1 }
      ]
    }
  },
  "transactions": [
    {
      "_id": "<transaction-id>",
      "type": "collection",
      "status": "completed",
      "amountCents": 12500,
      "reference": "COL-0123456789ABCDEF",
      "description": "Incoming payment request",
      "createdAt": "<ISO-8601 timestamp>"
    }
  ]
}
```

**Errors:** `401` authentication required; `404` wallet not found; `503` database unavailable.

**Example:**

```bash
curl http://localhost:5000/wallet \
  -H "Authorization: Bearer <jwt>"
```

### Get wallet summary

**Endpoint:** `/api/wallet/summary`  
**Method:** `GET`  
**Authentication:** User

**Request:** No body.

**Response (`200`):** `success`, wallet balances (including the daily streak status and reward schedule), `summary.totalTransactions`, `summary.pendingTransactions`, and up to five `recentTransactions`.

**Errors:** `401` authentication required; `404` wallet not found; `503` database unavailable.

**Example:**

```bash
curl http://localhost:5000/wallet/summary \
  -H "Authorization: Bearer <jwt>"
```

### Claim daily streak reward

**Endpoint:** `/api/wallet/daily-streak/claim`

**Method:** `POST`

**Authentication:** User

**Request:** No body. Each UTC calendar day may be claimed once. The consecutive-day count advances if the prior claim was yesterday and restarts at day 1 after a missed day. Reward tiers repeat every seven days: 50, 75, 100, 125, 150, 200, then 300 VEs plus one spin. Rewards are non-cash and do not change the USD balance.

**Response (`200`):** `message`, the claimed `reward` (`streakDay`, `cycleDay`, `ves`, `spins`), and the updated serialized `wallet`.

**Errors:** `401` authentication required; `404` wallet not found; `409` today's reward has already been claimed.

```bash
curl -X POST http://localhost:5000/wallet/daily-streak/claim \
  -H "Authorization: ******"
```

### Demo payments and rewards

These authenticated endpoints power the responsive demo wallet only. Demo payments use a separate `demoBalanceCents`; they do not touch `balanceCents` or the real wallet ledger. UPI/card/Razorpay and payout actions are simulated. The demo reward catalog contains only bonus coins and simulated wallet credit; it does not generate merchant voucher codes.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/wallet/rewards` | List demo coins and simulated wallet credit |
| `POST` | `/api/wallet/rewards/:rewardId/redeem` | Redeem a catalog item using VEs/spins |
| `POST` | `/api/wallet/demo/payments` | Simulate incoming UPI/card funds into the demo balance |
| `POST` | `/api/wallet/demo/withdrawals` | Simulate outgoing UPI/bank transfer from the demo balance |

All `POST` requests require an `Idempotency-Key`. Demo payment JSON is `{ "amountCents": 2500, "method": "upi" }`; allowed methods are `upi`, `card`, and `razorpay`. Demo withdrawal JSON is `{ "amountCents": 2500, "method": "razorpay" }`; allowed methods are `upi`, `razorpay`, and `bank_transfer`. Razorpay is a display/simulation option only; no Razorpay checkout, API request, or settlement occurs. Amounts must be positive integer cents, at most `$500.00` per demo request. Demo withdrawals also require sufficient demo balance. Responses return an updated wallet and an explicit simulation message. Reward redemption returns a generated `demoCode`, which is not a merchant voucher or payment credential.

**Errors:** `400` invalid amount, method, or idempotency key; `401` authentication required; `404` unknown reward or wallet; `409` duplicate request, insufficient rewards/balance, or demo-balance limit reached.

### Live integration availability

`GET /api/wallet/integrations` (authenticated) reports provider readiness without exposing credentials. The server includes injectable provider interfaces for Amazon AGCOD gift-card issuance, a provider-neutral voucher issuer, Razorpay Checkout, and RazorpayX Payouts. No live provider adapter is configured in this release, so live issuance and payments are unavailable. Provider actions must reject with `503` until the approved provider adapter and required configuration are installed; the Razorpay paths also remain blocked until INR/paise wallet accounting is implemented.

All integration switches in `backend/.env.example` default to `false`. A switch alone does not activate a provider: the matching server-side adapter is also required. Amazon AGCOD additionally requires approved partner access and prefunding. Voucher fulfillment requires selecting and onboarding an eligible issuer. Razorpay Checkout and RazorpayX Payouts are separate services and require their respective account approvals. Do not place provider secrets in frontend configuration or source control.

The wallet currently records USD cents only. `INR_WALLET_ENABLED` cannot activate INR operations because INR wallet accounting is not implemented. Do not enable real INR collections or payouts until an INR balance model and migration/accounting policy are designed and implemented.

### Read ledger

**Endpoint:** `/api/wallet/ledger?limit=25&cursor=<ledger-id>`  
**Method:** `GET`  
**Authentication:** User

**Request:** Optional `limit` integer from 1 to 100 (default 25) and optional ledger ObjectId `cursor`. Results belong only to the authenticated user's wallet.

**Response (`200`):**

```json
{
  "entries": [
    {
      "_id": "<ledger-id>",
      "type": "collection_credit",
      "direction": "credit",
      "amountCents": 12500,
      "balanceAfterCents": 12500,
      "reference": "COL-0123456789ABCDEF",
      "description": "Incoming payment request"
    }
  ],
  "nextCursor": null
}
```

**Errors:** `400` invalid limit or cursor; `401` authentication required; `503` database unavailable.

**Example:**

```bash
curl "http://localhost:5000/wallet/ledger?limit=25" \
  -H "Authorization: Bearer <jwt>"
```

### List available payout options

**Endpoint:** `/api/wallet/payout-options`  
**Method:** `GET`  
**Authentication:** User

**Request:** No body.

**Response (`200`):**

```json
{
  "options": [
    {
      "code": "bank_transfer",
      "label": "Bank transfer",
      "eta": "1-3 business days"
    },
    {
      "code": "mobile_money",
      "label": "Mobile money",
      "eta": "Usually within minutes"
    }
  ]
}
```

Only active options are returned. Supported codes are `bank_transfer` and `mobile_money`; an internal `PayoutOption` record can deactivate a supported method. There is no per-method detail endpoint.

**Errors:** `401` authentication required; `503` database unavailable.

**Example:**

```bash
curl http://localhost:5000/wallet/payout-options \
  -H "Authorization: Bearer <jwt>"
```

### Create a collection request

**Endpoint:** `/api/wallet/collections`  
**Method:** `POST`  
**Authentication:** User; `Idempotency-Key` required

**Request:**

```http
Idempotency-Key: collection-20261008-01
Content-Type: application/json
```

```json
{
  "amountCents": 2500,
  "note": "Invoice 1042"
}
```

`amountCents` must be a positive safe integer, no greater than 1,000,000,000 cents. `note` is optional and up to 100 characters. The amount must fit under the configured maximum wallet balance. Creating a collection request does not credit the wallet; only a verified provider success webhook does.

**Response (`201`; `200` for replay):**

```json
{
  "message": "Collection request recorded. Balance changes only after signed provider settlement.",
  "transaction": {
    "_id": "<transaction-id>",
    "type": "collection",
    "status": "pending",
    "amountCents": 2500,
    "reference": "COL-0123456789ABCDEF"
  },
  "replayed": false
}
```

**Errors:** `400` invalid amount, note, or idempotency key; `401` authentication required; `404` wallet not found; `409` wallet balance cap exceeded or conflicting idempotency key; `503` MongoDB transactions unsupported.

**Example:**

```bash
curl -X POST http://localhost:5000/wallet/collections \
  -H "Authorization: Bearer <jwt>" \
  -H "Idempotency-Key: collection-20261008-01" \
  -H "Content-Type: application/json" \
  -d "{\"amountCents\":2500,\"note\":\"Invoice 1042\"}"
```

### Submit a withdrawal

**Endpoint:** `/api/wallet/withdrawals`  
**Method:** `POST`  
**Authentication:** User; `Idempotency-Key` required; additional verification flag must be clear

**Request:**

```http
Idempotency-Key: withdrawal-20261008-01
Content-Type: application/json
```

```json
{
  "amountCents": 2500,
  "method": "bank_transfer"
}
```

`amountCents` must be positive and within the configured per-withdrawal maximum. `method` must be an available payout option. The available wallet balance is reserved atomically when submitted.

**Response (`201`; `200` for replay):**

```json
{
  "message": "Withdrawal submitted and funds reserved pending provider payout.",
  "transaction": {
    "_id": "<transaction-id>",
    "type": "withdrawal",
    "status": "pending",
    "amountCents": 2500,
    "reference": "WDR-0123456789ABCDEF"
  },
  "wallet": {
    "balanceCents": 10000
  },
  "replayed": false
}
```

**Errors:** `400` invalid amount, unavailable or unsupported payout option, or invalid idempotency key; `401` authentication required; `403` additional verification required; `404` wallet not found; `409` insufficient balance, duplicate/conflicting withdrawal request, or balance conflict; `503` MongoDB transactions unsupported.

**Example:**

```bash
curl -X POST http://localhost:5000/wallet/withdrawals \
  -H "Authorization: Bearer <jwt>" \
  -H "Idempotency-Key: withdrawal-20261008-01" \
  -H "Content-Type: application/json" \
  -d "{\"amountCents\":2500,\"method\":\"bank_transfer\"}"
```

## Administrator APIs

Every `/api/admin/*` endpoint requires a valid JWT for a user whose persisted `role` is `admin`. Public registration does not grant this role; administrators must be provisioned through a trusted internal process. All wallet modifications and withdrawal decisions are audited transactionally.

### List withdrawals

**Endpoint:** `/api/admin/withdrawals?status=pending&limit=25&cursor=<id>`  
**Method:** `GET`  
**Authentication:** Administrator

**Request:** Optional status (`pending`, `approved`, `rejected`, `completed`, `failed`), limit (1-100, default 25), and withdrawal ObjectId cursor.

**Response (`200`):** `{ "withdrawals": [...], "nextCursor": "<id-or-null>" }`. Each withdrawal includes its user, wallet, amount, method, status, reference, review fields, provider event ID, and timestamps.

**Errors:** `400` invalid filter, limit, or cursor; `401` authentication required; `403` administrator authorization required.

**Example:**

```bash
curl "http://localhost:5000/admin/withdrawals?status=pending&limit=25" \
  -H "Authorization: Bearer <admin-jwt>"
```

### Get a withdrawal

**Endpoint:** `/api/admin/withdrawals/:withdrawalId`  
**Method:** `GET`  
**Authentication:** Administrator

**Request:** Use the withdrawal MongoDB ObjectId as `withdrawalId`.

**Response (`200`):** `{ "withdrawal": { ... } }`, including populated account and reviewer name/email where available.

**Errors:** `400` invalid ID; `401` authentication required; `403` administrator authorization required; `404` withdrawal not found.

**Example:**

```bash
curl http://localhost:5000/admin/withdrawals/<withdrawal-id> \
  -H "Authorization: Bearer <admin-jwt>"
```

### Approve or reject a withdrawal

**Approve endpoint:** `/api/admin/withdrawals/:withdrawalId/approve`  
**Reject endpoint:** `/api/admin/withdrawals/:withdrawalId/reject`  
**Method:** `POST`  
**Authentication:** Administrator

**Request:** Optional JSON body for either decision:

```json
{
  "reason": "Reviewed against payout records"
}
```

Reason is optional and limited to 120 characters. A rejected withdrawal refunds its reserved funds and adds a ledger entry. An approved withdrawal remains eligible for provider settlement.

**Response (`200`):** `{ "success": true, "message": "...", "withdrawal": { ... }, "transaction": { ... } }`.

**Errors:** `400` invalid ID or reason; `401` authentication required; `403` administrator authorization required; `404` withdrawal missing or already reviewed; `503` MongoDB transactions unsupported.

**Example:**

```bash
curl -X POST http://localhost:5000/admin/withdrawals/<withdrawal-id>/approve \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d "{\"reason\":\"Reviewed against payout records\"}"
```

### Review transactions

**Endpoint:** `/api/admin/transactions?type=withdrawal&status=pending&userId=<id>&limit=25&cursor=<id>`  
**Method:** `GET`  
**Authentication:** Administrator

**Request:** Optional filters: type (`collection`, `withdrawal`, `refund`, `adjustment`), status (`pending`, `completed`, `failed`), user ObjectId, limit (1-100, default 25), and transaction ObjectId cursor.

**Response (`200`):** `{ "transactions": [...], "nextCursor": "<id-or-null>" }`; user name and email are populated.

**Errors:** `400` invalid filter, ID, limit, or cursor; `401` authentication required; `403` administrator authorization required.

**Example:**

```bash
curl "http://localhost:5000/admin/transactions?type=withdrawal&status=pending" \
  -H "Authorization: Bearer <admin-jwt>"
```

### Review audit logs

**Endpoint:** `/api/admin/audit-logs?actorId=<id>&targetUserId=<id>&limit=25&cursor=<id>`  
**Method:** `GET`  
**Authentication:** Administrator

**Request:** Optional administrator `actorId`, affected `targetUserId`, limit (1-100, default 25), and audit-log ObjectId cursor.

**Response (`200`):** `{ "entries": [...], "nextCursor": "<id-or-null>" }`; actor and target account name/email are populated.

**Errors:** `400` invalid ID, limit, or cursor; `401` authentication required; `403` administrator authorization required.

**Example:**

```bash
curl "http://localhost:5000/admin/audit-logs?limit=25" \
  -H "Authorization: Bearer <admin-jwt>"
```

### Credit or debit a wallet

**Credit endpoint:** `/api/admin/wallet/credit`  
**Debit endpoint:** `/api/admin/wallet/debit`  
**Method:** `POST`  
**Authentication:** Administrator; `Idempotency-Key` required (or an `idempotencyKey` body field)

**Request:**

```json
{
  "userId": "<account-object-id>",
  "amountCents": 2500,
  "reference": "manual-adjustment-1042",
  "description": "Support-approved correction"
}
```

`reference` and `description` are optional, up to 120 characters. Amount must be a positive safe integer. Credits are checked against the configured wallet-balance cap; debits cannot exceed the current balance.

**Response (`201`; `200` for replay):** `{ "success": true, "message": "...", "transaction": { ... }, "wallet": { ... }, "replayed": false }`.

**Errors:** `400` invalid account ID, amount, or idempotency key; `401` authentication required; `403` administrator authorization required; `404` wallet not found; `409` insufficient balance, balance cap exceeded, or conflicting idempotency key; `503` MongoDB transactions unsupported.

**Example:**

```bash
curl -X POST http://localhost:5000/admin/wallet/credit \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Idempotency-Key: admin-credit-20261008-01" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"<account-object-id>\",\"amountCents\":2500,\"description\":\"Support-approved correction\"}"
```

### Correct a wallet balance

**Endpoint:** `/api/admin/wallet/correct`  
**Method:** `POST`  
**Authentication:** Administrator; `Idempotency-Key` required (or an `idempotencyKey` body field)

**Request:**

```json
{
  "userId": "<account-object-id>",
  "targetBalanceCents": 12500,
  "reference": "reconciliation-1042",
  "description": "Correction from approved statement"
}
```

The backend computes the signed difference from the persisted wallet balance and writes a corresponding credit/debit transaction and immutable ledger entry. The operation and audit record commit in the same MongoDB transaction.

**Response (`201`; `200` for replay):** Wallet and adjustment transaction, including `replayed`.

**Errors:** `400` invalid account, target, reference, description, or idempotency key; `401` authentication required; `403` administrator authorization required; `404` wallet not found; `409` no balance difference, insufficient balance, target exceeds the wallet limit, or conflicting idempotency key; `503` MongoDB transactions unsupported.

**Example:**

```bash
curl -X POST http://localhost:5000/admin/wallet/correct \
  -H "Authorization: ******" \
  -H "Idempotency-Key: reconcile-20261013-01" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"<account-object-id>\",\"targetBalanceCents\":12500,\"description\":\"Approved reconciliation\"}"
```

### Configure a payout option

**Endpoint:** `/api/admin/payout-options/:code`  
**Method:** `PATCH`  
**Authentication:** Administrator

**Request:**

```json
{
  "label": "Bank transfer",
  "eta": "1-3 business days",
  "active": true
}
```

Only supported payout codes (`bank_transfer`, `mobile_money`) can be configured. The before/after configuration is recorded in the immutable audit log in the same transaction.

**Response (`200`):** `{ "success": true, "option": { "code": "...", "label": "...", "eta": "...", "active": true } }`.

**Errors:** `400` unsupported code or invalid fields; `401` authentication required; `403` administrator authorization required; `503` MongoDB transactions unsupported.

**Example:**

```bash
curl -X PATCH http://localhost:5000/admin/payout-options/bank_transfer \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"Bank transfer\",\"eta\":\"1-3 business days\",\"active\":false}"
```

## Provider webhook

### Receive a payment or payout event

**Endpoint:** `/api/webhooks/payments`  
**Method:** `POST`  
**Authentication:** Provider HMAC signature (not a user JWT)

Set `PAYMENT_WEBHOOK_SECRET` to a random secret of at least 32 characters. The provider signs the exact raw JSON body.

**Request headers:**

```http
X-Provider-Timestamp: <unix-seconds>
X-Provider-Signature: <hex-hmac-sha256>
Content-Type: application/json
```

Signature input is `<timestamp>.<raw-request-body>` using HMAC-SHA256. The timestamp must be within five minutes of server time. Accepted event types are `collection.succeeded`, `withdrawal.succeeded`, and `withdrawal.failed`; reference, amount, and currency must match the recorded operation.

```json
{
  "eventId": "provider-event-0001",
  "type": "collection.succeeded",
  "reference": "COL-0123456789ABCDEF",
  "amountCents": 2500,
  "currency": "USD"
}
```

**Response (`200`):** `{ "success": true, "duplicate": false, "status": "completed" }`; an identical replay returns `{ "success": true, "duplicate": true }`.

**Errors:** `400` invalid payload; `401` missing, expired, or mismatched signature; `404` matching pending transaction not found; `409` event ID reused with a different payload; `503` webhook secret or MongoDB transaction support unavailable.

**Example:** Generate the HMAC over the exact serialized body; do not reserialize JSON between signing and sending.

```bash
curl -X POST http://localhost:5000/webhooks/payments \
  -H "X-Provider-Timestamp: <unix-seconds>" \
  -H "X-Provider-Signature: <hex-hmac-sha256>" \
  -H "Content-Type: application/json" \
  --data-binary @event.json
```

## Service status

### Health check

**Endpoint:** `/api/health`  
**Method:** `GET`  
**Authentication:** None

**Request:** No body.

**Response (`200`):** Reports whether JWT authentication is configured, database connectivity/state, and whether MongoDB transactions are supported.

**Errors:** This endpoint is intended to remain available for readiness checks; it can report disconnected database state in a successful response.

**Example:**

```bash
curl http://localhost:5000/health
```

The root endpoint `/` is also public and returns a short API-running message.

## Endpoint names not currently implemented

The following example paths are not routes in this backend and must not be called as if they were supported:

| Requested example | Current implemented route |
| --- | --- |
| `GET /api/wallet/transactions` | `GET /api/wallet` includes the 10 latest transaction summaries; `GET /api/wallet/ledger` returns the balance journal |
| `GET /api/payout/methods` | `GET /api/wallet/payout-options` |
| `GET /api/payout/options/:method` | No per-method detail endpoint; the options list contains active methods |
| `GET /api/withdrawals` | Admin-only `GET /api/admin/withdrawals`; no customer-scoped withdrawal list exists |
| `GET /api/withdrawals/:id` | Admin-only `GET /api/admin/withdrawals/:withdrawalId`; no customer-scoped withdrawal detail exists |
| `POST /api/withdrawals` | `POST /api/wallet/withdrawals` |

## Local administrator and demo data

The public registration and login endpoints do not create or promote administrators. To provision a development administrator, configure `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the local `.env`, then run `npm run provision:admin`. This script refuses production mode and only connects to MongoDB on the local machine.

For demonstration data, configure `DEMO_USER_PASSWORD` and run `npm run seed:demo` against a local MongoDB replica set. This creates the clearly marked `demo@veloop.test` user, a wallet with VEs/SVEs/gems/tokens/spins, and sample Ad Reward, Daily Reward, Referral Reward, Bonus, and Withdrawal activity. The financial USD balance is kept consistent with its ledger. The seed command is idempotent and does not overwrite an existing demo password or non-empty wallet.

## Environment variables

Copy the safe template in `.env.example` to a local `.env` and set `MONGO_URI` to the connection string from Atlas (**Connect → Drivers**) or a local replica set. For Atlas, create a database user and allow the development machine's IP in Network Access. URL-encode reserved characters in the database user's password before placing it in the URI. Start the backend and check `/health`; `database.connected` and `database.transactionsSupported` should both be `true`. **Never commit `.env`, real database credentials, JWT signing keys, webhook secrets, or production credentials.** The repository ignores `.env`; commit only the placeholder template.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `5000`. |
| `MONGO_URI` | For persistent storage | MongoDB connection URI. Use MongoDB Atlas or a replica set for balance-changing operations. |
| `JWT_SECRET` | For auth | Random signing secret with at least 32 characters. Never use the example placeholder in a real environment. |
| `PAYMENT_WEBHOOK_SECRET` | For provider settlement | Separate random HMAC secret with at least 32 characters. |
| `ADMIN_NAME` | For local admin provisioning | Name assigned by the local `npm run provision:admin` script. |
| `ADMIN_EMAIL` | For local admin provisioning | Email assigned by the local `npm run provision:admin` script. |
| `ADMIN_PASSWORD` | For local admin provisioning | Unique password (at least 12 characters) used only by the local provisioning script. |
| `DEMO_USER_PASSWORD` | For local demo seeding | Password (at least 12 characters) for `demo@veloop.test`. |
| `MAX_WALLET_BALANCE_CENTS` | No | Maximum wallet balance; defaults to `500000` cents. |
| `MAX_WITHDRAWAL_AMOUNT_CENTS` | No | Maximum single withdrawal; defaults to `250000` cents. |
| `FIXED_PAYOUT_AMOUNT_CENTS` | No | Fixed payout amount setting; defaults to `50000` cents. |

The application requires a MongoDB replica set or sharded cluster for transactional wallet adjustments, withdrawals, and webhook settlements. If `MONGO_URI` is unset, the server starts without a database connection, and database-dependent routes return `503`.
