# Pelsung Finance — Workspace

Next.js 15 (App Router) · React 19 · TypeScript · TanStack Query.

```
src/
├── app/
│   ├── layout.tsx              Root layout + providers
│   ├── login/page.tsx          Sign-in
│   └── (workspace)/            Signed-in shell: sidebar, top bar, notices, password gate
│       ├── dashboard/  budget/  vouchers/  tds-remittance/
│       ├── payroll/  approvals/  ledger/  reports/  users/
├── components/
│   ├── shell/                  App frame and the per-route permission guard
│   ├── budget/  vouchers/  payroll/  account/  ui/
├── lib/
│   ├── api.ts                  Typed API client, ApiError with conflict figures
│   ├── payroll-tax.ts  vouchers.ts  fiscal-year.ts  permissions.ts   (mirrors of backend/src/domain)
│   ├── ledger.ts  reports.ts  totals.ts  format.ts  navigation.ts
├── providers/app-provider.tsx  Snapshot query, fiscal year, notices, mutation runner
└── types/index.ts              The API contract
```

## Setup

```bash
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                    # http://localhost:3000
```

The API must be running and must list this origin in its `CORS_ORIGINS`, since
the session travels as a cookie.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (next/core-web-vitals + TypeScript) |

## How state works

`AppProvider` holds one TanStack Query for the accounting snapshot, keyed by
fiscal year. Screens read it through `useApp()`; they never fetch on their own.

Mutations go through `run()`:

```tsx
const { run, fiscalYear } = useApp();

await run(
  () => api.addSupplementaryBudget({ fiscalYear, activityId, amountNu, reason }),
  "Supplementary budget added.",
);
```

`run` calls the API, stores the refreshed snapshot the server returns, shows the
notice, and returns `true`/`false` so a modal can stay open on failure. Because
the server answers with the full snapshot, there is no optimistic update to
reconcile and no screen can drift from the ledger. A `401` returns to sign-in.

## Design

`app/globals.css` is the original stylesheet, unchanged, with a clearly marked
additions block at the end for two things the rewrite needed: navigation styles
for `<Link>` anchors (the single-page build navigated with `<button>`), and a
fix for large Ngultrum figures that were being clipped inside the KPI cards.

Print styles carry over as they were: vouchers, payslips, pay bills, the IT-1(a)
schedule and every report print from the browser with the right layout —
`window.print()` on the open modal or report.

## Calculations in the browser

`lib/payroll-tax.ts` and `lib/vouchers.ts` are copies of the backend's domain
modules so forms can show a live figure as the user types — the TDS on a
voucher, an employee's net pay. They are previews only: the server recomputes
every value before writing, and its result is what gets stored and displayed
afterwards. When a rule changes, change `backend/src/domain/` first and copy the
file across.

## Deployment

Vercel, or any Node host:

```bash
npm ci && npm run build && npm start
```

Set `NEXT_PUBLIC_API_URL` to the public API URL and `NEXT_PUBLIC_SITE_URL` to
this application's own URL (used for social preview images). Both are build-time
public values — no secret belongs in this package.
