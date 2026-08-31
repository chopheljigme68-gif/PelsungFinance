# Migrating the live D1 data into Supabase

Moves everything from the deployed Cloudflare D1 (SQLite) database into the new
Supabase Postgres schema: users, budget, vouchers, payroll, remittances,
history and the audit trail.

**Passwords survive.** Each hash carries its own iteration count, so accounts
hashed at the old 100,000-iteration work factor keep signing in unchanged.
Sessions are deliberately not carried over — everyone signs in once more.

---

## Steps

### 1. Export from Cloudflare

```bash
npx wrangler d1 export <DATABASE_NAME> --remote --output=pelsung-d1-export.sql
```

Keep this file. It is your rollback, and the migration never writes to it.

### 2. Prepare an empty Supabase database

```bash
cd backend
npm run db:migrate        # creates the schema — do NOT run db:seed
```

Skip `db:seed`: it would create a bootstrap admin and a second copy of the
approved budget, and the import expects empty tables.

### 3. Rehearse

```bash
npm run db:import -- ./pelsung-d1-export.sql --dry-run
```

Nothing is written. You get the row counts found, any references that no longer
resolve, and every row the new schema would reject. **Read this output before
going further** — if it lists problems, fix them in the source and export again.

### 4. Import

```bash
npm run db:import -- ./pelsung-d1-export.sql
```

The whole load runs in one transaction: it lands completely or not at all.

### 5. Reconcile

The command finishes with a comparison of source against target — row counts,
total approved budget, total voucher value, total TDS withheld, total net
payroll. **Every line must show ✓.** Then sign in and check the Dashboard
figures against the old system before telling anyone to switch.

---

## Options

| Flag | Effect |
| --- | --- |
| `--dry-run` | Validate and report only |
| `--replace` | Delete existing rows first (refused without it if the target has data) |
| `--skip-invalid` | Leave rejected rows behind instead of aborting |

A `.sqlite`/`.db` file works in place of the `.sql` export.

## What the pre-flight checks

It aborts rather than failing half way through, and names each offending row:

- Values outside what the new schema allows — a `tds_rate` that is not 0/2/5, a
  `budget_type` that is not Current or Capital, an unsupported status or role
- Department names differing only by case (`Secretariat` and `secretariat`),
  which the new schema treats as one name
- More than one live supplier TDS remittance for the same month and rate
- History rows pointing at budget activities or users missing from the export

## What it repairs on the way through

The old database accumulated some legacy shapes. These are normalised, and the
reconciliation proves nothing moved:

| Legacy shape | Handling |
| --- | --- |
| Voucher with `net_payment_nu = 0` | Recomputed from gross, GST, TDS and advance recovery — exactly as the old runtime did on read |
| Voucher predating `voucher_budget_lines` | Its single `activity_id` is expanded into one allocation line, so committed budget stays correct |
| Employee with no `basic_pay_nu` | Falls back to gross pay |
| `exempt_allowances_nu` | Folded into allowances (the column no longer exists) |
| `created_by` pointing at a purged user | Cleared; the voucher and its history are kept |
| `release_forecasts` rows | No table in the new schema (the feature had no screen) — archived to `<export>-release-forecasts.json` rather than discarded |

Identity sequences are realigned afterwards, so the next voucher continues the
existing numbering instead of colliding with it.

---

## Verified

The migration was exercised against a database built on the original D1 schema
and loaded with the awkward cases above — 21 checks through the live API,
including a password hashed at the old work factor signing in, rebuilt
allocation lines producing the correct committed budget, a reversal keeping its
reason and approver, and a new voucher continuing the numbering at `PV.7.05`.
Both the `.sql` export and `.sqlite` file paths were tested, along with the
refusal to overwrite a populated database and the pre-flight abort on damaged
rows.

## If something looks wrong afterwards

Nothing in Cloudflare has been touched. Point the frontend back at the old
deployment, drop the Supabase tables, and start again from the export.
