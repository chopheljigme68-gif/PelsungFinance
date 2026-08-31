# Pelsung Finance — API

Node 20 · Express 4 · TypeScript · Drizzle ORM · Supabase Postgres.

```
src/
├── config/env.ts          Zod-validated environment; the process refuses to start misconfigured
├── db/
│   ├── schema.ts          Tables, indexes and check constraints
│   ├── client.ts          postgres-js pool + driver type parsing
│   ├── migrate.ts         Applies ./drizzle migrations
│   ├── seed.ts            Bootstrap admin + approved FY 2026-2027 budget (idempotent)
│   └── budget-seed-data.ts
├── domain/                Pure business rules — no I/O, directly testable
│   ├── payroll-tax.ts     Rule 153, Annexure I, Health Contribution
│   ├── vouchers.ts        TDS/GST/net-payment arithmetic, numbering, bank effect
│   ├── fiscal-year.ts     July–June calendar, pay months, references
│   └── permissions.ts     Roles and the permission matrix
├── lib/                   Errors, password hashing, audit, email, HTTP helpers, logger
├── middleware/            Auth, RBAC, error mapping, CORS/CSRF, rate limits
├── modules/               One folder per bounded area: routes → service → database
│   ├── auth/  accounting/  budget/  vouchers/  payroll/  remittance/  users/
└── routes/index.ts        Router composition and the shared mutation gate
```

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### Supabase connection string

Project Settings → Database → Connection string → URI. Either pooler works:

- **Session pooler**, port 5432 — recommended.
- **Transaction pooler**, port 6543 — also supported; prepared statements are
  already disabled in `db/client.ts`, which is what that mode requires.

URL-encode any special characters in the password. Keep `DATABASE_SSL=true`.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch mode |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm test` | Domain unit tests |
| `npm run db:generate` | Generate a migration after editing `schema.ts` |
| `npm run db:migrate` / `db:seed` / `db:setup` | Apply migrations, seed, or both |
| `npm run db:import -- <export>` | Migrate a Cloudflare D1 export into Supabase (see `MIGRATION.md`) |
| `node tests/api.smoke.mjs` | Full end-to-end run against a live server |

## API

Base URL `/api`. Authentication is an httpOnly session cookie
(`pelsung_session`, 8 hours by default), so browsers must call with
`credentials: "include"`.

Every mutation returns the **complete refreshed accounting snapshot** for the
active fiscal year, plus `actionNotice` when the server has something to say
(for example an invitation that could not be delivered).

| Method | Route | Permission |
| --- | --- | --- |
| `GET` | `/health` | — |
| `GET` | `/auth/session` | signed in |
| `POST` | `/auth/login` · `/auth/logout` · `/auth/password` | — / signed in |
| `GET` | `/accounting?fiscalYear=YYYY-YYYY` | signed in |
| `POST` | `/budget/activities` | `manage_budget` |
| `POST` | `/budget/reappropriations` | `reappropriate_budget` |
| `POST` | `/budget/supplementary` | `supplementary_budget` |
| `POST` | `/vouchers` | `create_voucher` or `record_fund_receipt` |
| `POST` | `/vouchers/:id/submit` | author of a generated Draft |
| `PATCH` | `/vouchers/:id/status` | `approve_voucher` |
| `POST` | `/vouchers/:id/reverse` | `approve_voucher` |
| `POST`/`PATCH` | `/payroll/departments[/:id]` | `manage_departments` |
| `POST`/`PUT`/`PATCH` | `/payroll/employees[/:id][/status\|/identity]` | `add_employee` |
| `POST` | `/payroll/pay-bills/finalize` · `/post` | `manage_payroll` |
| `POST` | `/payroll/pay-bills/undo-posting` · `/unfinalize` | `undo_payroll` |
| `POST` | `/remittance/payroll/finalize` · `/post` | `manage_payroll` |
| `POST` | `/remittance/supplier-tds/finalize` | `create_voucher` |
| `POST`/`PUT`/`PATCH`/`DELETE` | `/users[/:id][/role\|/invitation]` | `manage_users` |

Errors are always `{ "error": "…" }`. Conflicts add the figures the UI needs:

```jsonc
// 409 — the activity moved between preparation and approval
{
  "error": "17.01 · Advertisement cannot be approved because its allocation is greater than the available balance.",
  "availableBalanceNu": 84000,
  "expenditureAmountNu": 120000
}
```

`428` means the signed-in user still holds a temporary password: change it
before transacting.

## Security

- PBKDF2-HMAC-SHA256 at 210,000 iterations; the iteration count is stored per
  record so older hashes keep verifying after the factor is raised.
- Sessions are random 256-bit tokens; only their SHA-256 digest is stored, so a
  database leak does not yield usable cookies. Changing a password, role or
  username revokes the other sessions.
- Five failed sign-ins lock an account for 15 minutes; the sign-in endpoint is
  additionally rate-limited per address.
- State-changing requests must carry an allow-listed `Origin`/`Referer`, on top
  of `SameSite` on the cookie.
- Helmet headers, a 1 MB JSON limit, and no SQL string interpolation anywhere —
  every query is parameterised.
- Logs redact cookies, authorization headers and every password field.

## Deployment

Any Node host (Render, Railway, Fly, a VM):

```bash
npm ci && npm run build
npm run db:migrate     # once per deployment
node dist/server.js
```

Set `NODE_ENV=production`, `COOKIE_SECURE=true`, the real `CORS_ORIGINS` and
`APP_URL`. `app.set("trust proxy", 1)` is already configured for a single
reverse proxy. `GET /api/health` reports database connectivity for health
checks. `SIGTERM` drains in-flight requests before closing the pool.
