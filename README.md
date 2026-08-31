# Pelsung Accounting Management System

Budget control, voucher processing, payroll and statutory reporting for Pelsung,
rebuilt as two independent applications:

```
pelsung-finance/
├── backend/         Node + Express + TypeScript API on Supabase Postgres
├── frontend/        Next.js 15 App Router workspace
├── package.json     Convenience scripts that drive both
├── README.md        This file
└── MIGRATION.md     Moving live Cloudflare D1 data into Supabase
```

The two packages are independent — each has its own dependencies, and each can
be deployed on its own. The root `package.json` only forwards commands to them,
so you never have to remember which folder you are in:

| From the root | Does |
| --- | --- |
| `npm run setup` | Installs both packages |
| `npm run db:setup` | Migrates and seeds the database |
| `npm run dev:api` / `npm run dev:web` | Starts either side (use two terminals) |
| `npm run build` | Production build of both |
| `npm test` · `npm run typecheck` · `npm run lint` | Across both |

The previous single-package build (Next.js on Cloudflare Workers with a D1
SQLite database, all logic in one 1,760-line API route and one 2,137-line page)
has been replaced. Every feature is preserved; the domain rules — Bhutan's
Annexure I salary tax, budget commitment control, the payroll and remittance
workflow — are unchanged and covered by tests.

---

## What the system does

| Module | Capability |
| --- | --- |
| **Budget** | Approved activity register per financial year, supplementary allocations, controlled re-appropriation with full history |
| **Vouchers** | Payment, Journal, Fund Receipt and Advance vouchers; multi-activity allocation; GST-adjusted TDS at 0/2/5%; advance recovery; printable statutory voucher form |
| **Approvals** | Approval queue with live budget re-verification, return, and reasoned reversal of approved vouchers |
| **Payroll** | Employee master, admin-managed departments, department pay bills, Pay Bill Posting to a combined payroll voucher, two-stage undo, payslips emailed on approval |
| **Tax** | Salary TDS under Rule 153 + Annexure I, 1% Health Contribution, monthly Form IT-1(a) remittance, supplier TDS remittance at 2% and 5% |
| **Reporting** | Expenditure statement, receipts & payments, outstanding advances, TDS schedules, budget balance, general ledger |
| **Administration** | Four roles, invitations with temporary passwords, forced first-sign-in password change, soft delete, immutable audit trail |

### Roles

| Role | Can do |
| --- | --- |
| **User** | Prepare vouchers, payroll data entry, reports |
| **Admin** | Everything: budget, vouchers, approvals, users, departments, payroll |
| **Approving Authority** | Approve and reverse vouchers, fund receipts, payroll, budget supplements and transfers |
| **Viewer** | Read-only dashboard, budget, payroll and reports |

Permissions are enforced in the API on every request; the UI only decides what
to show.

---

## Quick start

**Prerequisites:** Node 20.11+, a Supabase project (or any Postgres 14+).

### 1. Configure

```bash
cp backend/.env.example backend/.env          # fill in DATABASE_URL + BOOTSTRAP_ADMIN_PASSWORD
cp frontend/.env.example frontend/.env.local  # defaults already point at localhost:4000
```

### 2. Install and prepare the database

```bash
npm run setup        # installs both packages
npm run db:setup     # creates the schema, then the admin + approved FY 2026-2027 budget
```

### 3. Run — two terminals

```bash
npm run dev:api      # http://localhost:4000
npm run dev:web      # http://localhost:3000
```

Sign in with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`. The system
requires a new password before it will accept any transaction.

Each package has its own README with configuration, deployment and API details:

- [`backend/README.md`](backend/README.md)
- [`frontend/README.md`](frontend/README.md)

### Moving the live data across

If the deployed Cloudflare app holds real records, do not run `db:seed` — import
instead. [`MIGRATION.md`](MIGRATION.md) has the full procedure:

```bash
npx wrangler d1 export <DATABASE_NAME> --remote --output=pelsung-d1-export.sql
cd backend
npm run db:migrate
npm run db:import -- ./pelsung-d1-export.sql --dry-run   # rehearse
npm run db:import -- ./pelsung-d1-export.sql             # then import
```

Existing passwords keep working. The import runs in one transaction and ends
with a reconciliation of row counts and money totals against the source.

---

## Architecture

```
Browser ──► Next.js App Router (frontend)
                │  fetch with credentials: "include"
                ▼
        Express API (backend)  ── session cookie, RBAC, Zod validation
                │  Drizzle ORM, transactions
                ▼
        Supabase Postgres
```

**Why a single read model.** The API exposes `GET /api/accounting?fiscalYear=…`,
which returns the whole working set for one year, and every mutation replies
with the refreshed snapshot. Balances are derived (available = approved −
committed), so per-screen fetches would let the dashboard, the approval queue
and a report disagree with each other mid-transaction. One consistent snapshot
per request removes that class of bug, and the client never has to reconcile a
local guess against the server.

**Where the money rules live.** `backend/src/domain/` holds the tax tables,
voucher arithmetic, fiscal calendar and permission matrix as pure functions with
no database or HTTP dependencies — which is what makes them directly testable.
The same four files are mirrored in `frontend/src/lib/` so forms can preview a
calculation live; the server always recomputes before writing, so a stale mirror
can never corrupt a record.

**Concurrency.** Budget commitment is the contended resource: two vouchers
approved at once must not both consume the last of an activity's balance. Every
budget-touching operation runs in a transaction that locks the activity rows
(`SELECT … FOR UPDATE`) before re-reading the available balance, so the second
transaction sees the first one's effect and is refused with the real figure.

---

## Correctness

```bash
cd backend && npm test                     # 21 unit tests — tax bands, voucher maths, fiscal calendar, RBAC
cd backend && node tests/api.smoke.mjs     # 87 end-to-end API checks against a live server
cd frontend && npm run typecheck && npm run build
```

The smoke run exercises the complete cycle on a real database: sign-in and the
forced password change, budget activity → supplementary → re-appropriation,
voucher creation with GST/TDS, approval, advance and recovery, fund receipt and
reversal, department and employee setup, pay bill finalize → post → approve
(with payslip delivery), salary and supplier TDS remittance, both undo stages,
and user management — including the refusals: over-budget vouchers, stale pay
bill totals, double approval, deleting the last admin, reversing a remitted
voucher.

---

## Notable changes from the previous build

| Area | Before | Now |
| --- | --- | --- |
| Database | Cloudflare D1 (SQLite), schema created at runtime by an `initializeDatabase()` function on every cold start | Supabase Postgres with versioned Drizzle migrations |
| Atomicity | `db.batch()` — statements ran together but without rollback; guards were written as `WHERE changes() = 2` tricks | Real transactions with row locks; a failed guard rolls back everything |
| Money columns | SQLite `INTEGER` | `bigint` with explicit driver parsing (Postgres returns `SUM()` as `numeric`, i.e. a *string* — left unhandled this silently turns budget arithmetic into string concatenation) |
| API | One `POST /api/accounting` endpoint switching on 26 `action` strings | REST resources with per-route permissions and Zod schemas |
| Frontend | One 2,137-line client component holding every screen and modal | Route per module under the App Router, shared state in one provider, modals owned by their screen |
| Validation | Hand-rolled `String(body.x ?? "")` coercion per action | Zod schemas at the boundary, typed values downstream |
| Passwords | PBKDF2, 100,000 iterations (the Workers runtime ceiling) | PBKDF2, 210,000 iterations (OWASP guidance), with per-record iteration counts so existing hashes keep verifying |
| Email failure | Could leave a created user without an invitation and no way to retry | Account is created first, delivery reported separately, retry from User Management |

---

## Production notes

- Set `COOKIE_SECURE=true` and serve both applications over HTTPS.
- If the API and the workspace are on different domains, set
  `COOKIE_SAME_SITE=none` (with `COOKIE_SECURE=true`); on a shared parent domain
  set `COOKIE_DOMAIN` and keep `lax`.
- `CORS_ORIGINS` on the API must list the workspace origin exactly — cookies are
  refused otherwise.
- Email is optional. Without `RESEND_API_KEY` the system runs normally and
  reports invitations as pending; payslips are then only available in-app.
- Take Supabase point-in-time backups before each financial year close.
