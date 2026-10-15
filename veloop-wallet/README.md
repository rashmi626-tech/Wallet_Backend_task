# VELoop Rewards Wallet System

A local-development wallet demonstration with a React frontend and an Express/MongoDB backend. It supports account authentication, wallet balances in USD cents, collection requests, payout withdrawals, an append-only ledger, administrator review, and audit logs.

This project is for local development and evaluation only. Do not connect it to a production database or use production credentials.

## Technologies

- Node.js and Express
- MongoDB and Mongoose
- React and Vite
- Custom CSS
- JWT authentication and bcrypt password hashing

## Project layout

```text
backend/
  src/
    config/       MongoDB connection and transaction capability check
    controllers/  HTTP request handlers
    middleware/   authentication, authorization, validation/error handling
    models/       users, wallets, ledger, transactions, withdrawals, audit
    routes/       authentication, wallet, administrator, webhook routes
    services/     transactional wallet and withdrawal operations
    validators/   wallet and payout input validation
  scripts/        local-only administrator and demo-data setup
  test/           Node.js tests
frontend/
  src/            React application and styles
```

## Local setup

### 1. Clone the project

Replace `<repository-url>` with the repository URL provided by the project owner:

```powershell
git clone <repository-url> veloop-wallet
cd veloop-wallet
```

### 2. Install dependencies

From the project root, install each app's dependencies:

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

### 3. Configure a local MongoDB replica set

Wallet balance mutations use MongoDB transactions. Use a MongoDB instance running locally as a replica set (a single-node replica set is sufficient for development); a standalone MongoDB server can serve health checks but cannot safely process credits, withdrawals, or administrative balance changes.

For a local MongoDB installation, configure `mongod` with a replica-set name such as `rs0`, start it, then initialize it once with:

```powershell
mongosh --host 127.0.0.1:27017 --eval "rs.initiate()"
```

Use a local URI that specifies the same replica-set name, for example:

```text
mongodb://127.0.0.1:27017/veloop_wallet?replicaSet=rs0
```

Do not run the initialization command against a shared or production database.

### 4. Configure backend environment

From the project root, copy the template:

```powershell
Copy-Item backend/.env.example backend/.env
```

Then set `MONGO_URI` to the local replica-set URI and replace the JWT secret with a unique random value of at least 32 characters. A local random secret can be generated with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Configure local administrator/demo passwords as needed. Keep `.env` untracked and never commit real credentials.

The `DEFAULT_EMAIL`/`DEFAULT_PASSWORD` values are a local convenience for the demo sign-in flow. If the configured account does not exist, a successful sign-in with those values creates a local administrator account. These values must not be treated as production credentials.

### 5. Run backend and frontend

In separate terminals:

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm run dev
```

The default URLs are:

- Frontend: <http://localhost:5173>
- Backend health: <http://localhost:5000/health>

The frontend proxies `/api/*` requests to the backend, removing the `/api` prefix. Direct backend requests use routes such as `/auth/login` and `/wallet`.

The health response reports whether MongoDB is connected, whether JWT authentication is configured, and whether transaction support is available. For wallet mutations, `database.transactionsSupported` must be `true`.

## Authentication and API

Public users can register and log in. Passwords are hashed; authenticated requests use a 12-hour JWT in the `Authorization` header. Public registration always creates the ordinary user role. Administrator routes require an authenticated account with a persisted administrator role.

Major routes include:

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Public | Create a user and wallet |
| `POST` | `/auth/login` | Public | Sign in |
| `GET` | `/auth/me` | User | Read the current account |
| `GET` | `/wallet` | User | Read wallet and recent transactions |
| `GET` | `/wallet/summary` | User | Read wallet summary |
| `GET` | `/wallet/ledger` | User | Read the authenticated user's ledger |
| `GET` | `/wallet/payout-options` | User | List active payout methods |
| `POST` | `/wallet/collections` | User | Create a collection request |
| `POST` | `/wallet/withdrawals` | User | Reserve funds for a withdrawal |
| `GET` | `/admin/withdrawals` | Admin | Review withdrawals |
| `POST` | `/admin/withdrawals/:id/approve` | Admin | Approve a withdrawal |
| `POST` | `/admin/withdrawals/:id/reject` | Admin | Reject and refund a withdrawal |
| `GET` | `/admin/transactions` | Admin | Review transactions |
| `GET` | `/admin/audit-logs` | Admin | Review sensitive-action audit events |
| `POST` | `/admin/wallet/credit` | Admin | Credit a wallet |
| `POST` | `/admin/wallet/debit` | Admin | Debit a wallet |
| `POST` | `/admin/wallet/correct` | Admin | Correct a wallet balance |
| `PATCH` | `/admin/payout-options/:code` | Admin | Update payout configuration |

All amounts for wallet operations are integer USD cents. Reward counters such as VEs, SVEs, gems, tokens, and spins are separate from the withdrawable USD balance. Balance-changing API requests require an `Idempotency-Key`.

See [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md) for request/response examples, authentication details, validation rules, and errors for all supported APIs.

## Database architecture

- **User:** account identity, password hash, role, and verification flag.
- **Wallet:** current USD-cent balance plus separate non-withdrawable reward counters.
- **WalletTransaction:** user-facing activity and operation status.
- **WalletLedger:** append-only signed balance movements, each recording the resulting balance.
- **Withdrawal:** payout method, amount, status, reference, and review details.
- **PayoutOption:** administrator-managed availability/configuration for supported methods.
- **AuditLog:** actor, action, target, reference, request context, and metadata for sensitive operations.

Balance-changing operations update the wallet and write the transaction, ledger, and applicable audit records inside one MongoDB transaction. The explainable USD balance is:

```text
opening balance + ledger credits - ledger debits = current balance
```

Pending withdrawals reserve funds immediately. Rejecting a withdrawal restores the reserved balance and records a refund ledger entry.

## Security and reliability

- JWT authentication protects user routes; role authorization protects administrator routes.
- Passwords are hashed with bcrypt; user input and monetary amounts are validated server-side.
- Wallet changes require MongoDB transaction support and are not trusted to frontend-calculated balances.
- Idempotency keys prevent duplicate credits/withdrawals from being applied twice.
- Database and unexpected server errors are normalized instead of exposing internal details.
- Audit entries record administrator wallet changes, withdrawal decisions, and payout configuration changes.
- The local admin provisioning and demo seed scripts reject remote MongoDB URIs and production mode.
- **Rate limiting is not currently implemented.** This app is intended for local evaluation; before any internet-facing deployment, add and test appropriate rate limits (including shared/distributed limits for multiple backend instances), along with deployment-specific security controls.
- The Vite frontend's `VITE_*` values are public build-time values, not secrets. Never put private credentials in frontend environment variables.

## Demo data

For local demonstration only, configure `DEMO_USER_PASSWORD` in `backend/.env` and run:

```powershell
cd backend
npm run seed:demo
```

The seed script creates clearly labeled demo wallet activity and reward counters. It requires a local MongoDB replica set, checks that it is not running in production, and avoids reseeding when its marker transaction is already present.

To create or update a local administrator through the guarded provisioning script, configure `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`, then run:

```powershell
cd backend
npm run provision:admin
```

## Testing

Run backend tests:

```powershell
cd backend
npm test
```

Build and lint the frontend:

```powershell
cd frontend
npm run build
npm run lint
```

The backend tests cover balance reconciliation, withdrawal idempotency, insufficient balances, invalid payout methods, concurrent withdrawal safety, error normalization, authorization, schema indexes, and local-only script URI validation. For a live lifecycle check, use a local replica set and verify:

1. Credit a test user's wallet and confirm the ledger balance-after value.
2. Withdraw less than or equal to the available balance and confirm one debit.
3. Retry with the same idempotency key and confirm there is no second debit.
4. Attempt an over-balance withdrawal and confirm it is rejected without changing the balance.
5. Reject a pending withdrawal as an administrator and confirm the reserved amount is refunded and audited.
6. Reconcile the final wallet balance with the signed ledger entries.
