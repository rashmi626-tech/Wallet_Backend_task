# Wallet Data and API Contract

## Data model

- `User` owns one `Wallet`; wallet balances are stored as integer USD cents in `balanceCents`.
- `WalletTransaction` is the mutable business record. Supported types are `collection`, `withdrawal`, `refund`, and `adjustment`; statuses are `pending`, `completed`, and `failed`.
- `WalletLedger` is the append-only balance journal. Each row has a signed direction (`credit` or `debit`), positive `amountCents`, resulting `balanceAfterCents`, transaction reference, and globally unique idempotency key.
- `Withdrawal` tracks payout method, administrator review state, and provider state. `PayoutOption` can override default labels and deactivate a supported method.
- `AuditLog` is the append-only record of withdrawal creation/review, administrator wallet changes/corrections, and payout configuration changes. Entries are written in the same database transaction as the operation and retain actor/target/reference/request metadata.
- `WebhookEvent` stores unique provider event IDs to prevent replay.
- Never update or delete ledger rows. Corrections are new refund or adjustment transactions with matching ledger entries.
- Reconcile the USD `balanceCents` against the opening balance plus ledger credits minus ledger debits; all balance-changing paths write their ledger entries transactionally.

## Balance rules

- All API amounts are positive safe integers in cents. Maximum per operation: `1,000,000,000` cents. Fractional values, zero, negatives, and floating-point dollar amounts are rejected.
- The wallet balance is the available balance. A withdrawal request atomically debits it and records the pending payout and ledger debit.
- A successful collection request does not credit the wallet. A verified provider `collection.succeeded` event credits it exactly once.
- A successful withdrawal only completes its status. A verified `withdrawal.failed` event refunds the reserved amount with a new transaction and credit ledger row.
- Balance, transaction, payout, ledger, and webhook-event writes must commit together. Use MongoDB Atlas or a replica set. A standalone MongoDB server can serve read APIs but balance-changing APIs return `503`.
- Client-facing balance-credit and debit endpoints are not available. Administrator wallet adjustments are restricted to users with the persisted `admin` role, are idempotent, and are auditable.
- New accounts receive the `user` role. Provision or promote administrators only through a trusted internal process; public registration never accepts a role.
- A trusted risk/verification process can set a user's `requiresAdditionalVerification` flag. The withdrawal endpoint then returns `403` with an additional-verification message until the flag is cleared.
- Payout options default to the supported methods below. An internal operator can persist a `PayoutOption` record with `active: false` to make that supported payout method unavailable.

## API requirements

All paths below are mounted at the backend root; Vite exposes them under `/api`. Private endpoints require `Authorization: Bearer <token>`.

| Method and path | Purpose | Request requirements |
| --- | --- | --- |
| `POST /auth/register` | Create account and empty wallet | `name`, valid `email`, password of at least 8 characters |
| `POST /auth/login` | Start a session | `email`, `password` |
| `GET /auth/me` | Read signed-in account and balance | Bearer token |
| `GET /wallet` | Read balance and recent business transactions | Bearer token |
| `GET /wallet/ledger?limit=25&cursor=<id>` | Read newest ledger rows | Bearer token; `limit` 1-100; cursor is a ledger ObjectId |
| `GET /wallet/payout-options` | List supported payout methods | Bearer token |
| `POST /wallet/collections` | Create pending incoming-payment request | Bearer token, `Idempotency-Key`, JSON `{ "amountCents": 2500, "note": "Invoice 1042" }` |
| `POST /wallet/withdrawals` | Reserve funds and request payout | Bearer token, `Idempotency-Key`, JSON `{ "amountCents": 2500, "method": "bank_transfer" }` |
| `POST /webhooks/payments` | Settle collection or payout result | Provider HMAC headers and event payload, described below |
| `GET /health` | Read DB/auth/transaction capability | No authentication |

`Idempotency-Key` must be 8-100 characters using letters, digits, `_`, `-`, `.`, or `:`. Repeating the same key and same operation returns the original result; reusing it with different operation data returns `409`.

Collection and withdrawal methods currently supported: `bank_transfer`, `mobile_money`. Currency is currently USD only.

## Admin and internal control

All `/admin` routes require a persisted `admin` role. New accounts always receive the `user` role; administrator provisioning must happen through a trusted internal process.

| Method and path | Purpose |
| --- | --- |
| `GET /admin/withdrawals` | View withdrawals; supports `status`, `cursor`, and `limit` filters |
| `GET /admin/withdrawals/:withdrawalId` | View one withdrawal |
| `POST /admin/withdrawals/:withdrawalId/approve` | Approve a pending withdrawal |
| `POST /admin/withdrawals/:withdrawalId/reject` | Reject and refund a pending withdrawal; optional body `{ "reason": "..." }` |
| `GET /admin/transactions` | Review transactions; supports `type`, `status`, `userId`, `cursor`, and `limit` filters |
| `GET /admin/audit-logs` | Review admin actions; supports `actorId`, `targetUserId`, `cursor`, and `limit` filters |
| `POST /admin/wallet/credit` | Credit a user's wallet using `{ "userId": "...", "amountCents": 2500 }` and an `Idempotency-Key` |
| `POST /admin/wallet/debit` | Debit a user's wallet using `{ "userId": "...", "amountCents": 2500 }` and an `Idempotency-Key` |
| `POST /admin/wallet/correct` | Reconcile a user's balance to `targetBalanceCents`; the difference is recorded as an adjustment |
| `PATCH /admin/payout-options/:code` | Change a supported payout option; before/after values are audited |

Wallet adjustments and withdrawal decisions are recorded in immutable audit logs in the same transaction as their balance/withdrawal changes. Rejected withdrawals refund the reserved balance and write a ledger entry.

Public registration never grants the administrator role. For local development only, `npm run provision:admin` uses `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`; it refuses production mode and remote MongoDB hosts. `npm run seed:demo` creates `demo@veloop.test` plus clearly marked reward/withdrawal activity, and similarly refuses production or remote hosts. Set a local `DEMO_USER_PASSWORD` before running it.

## Payment webhook

Configure `PAYMENT_WEBHOOK_SECRET` with at least 32 random characters. The provider sends:

- `X-Provider-Timestamp`: Unix timestamp in seconds, no more than 5 minutes old.
- `X-Provider-Signature`: lowercase/uppercase hex HMAC-SHA256 of `timestamp + "." + raw_request_body` using the webhook secret.
- JSON `{ "eventId": "provider-unique-id", "type": "collection.succeeded", "reference": "COL-...", "amountCents": 2500, "currency": "USD" }`.

Allowed event types: `collection.succeeded`, `withdrawal.succeeded`, `withdrawal.failed`. Reference, amount, and currency must match the pending operation. Approved withdrawals remain eligible for provider settlement. Duplicate event IDs are acknowledged without applying a second balance change.

## Responses and errors

Amounts are returned as `amountCents`; balances as `balanceCents`. `201` means a new request was recorded; `200` means an idempotent replay or webhook acknowledgement. Common errors return safe, user-facing messages; unexpected database and server errors are logged server-side and never returned verbatim. `400` is invalid input, `401` missing/invalid authentication or signature, `403` insufficient authorization, `404` missing resource, `409` insufficient balance or conflicting idempotency key, and `503` missing configuration or unsupported MongoDB transaction topology.

Required backend environment: `MONGO_URI`, `JWT_SECRET` (at least 32 characters), and `PAYMENT_WEBHOOK_SECRET` (at least 32 characters to accept provider settlement events).