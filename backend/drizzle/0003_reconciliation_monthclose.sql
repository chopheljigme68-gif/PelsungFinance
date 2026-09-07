-- 0003: monthly bank reconciliation + month close.
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"account_number" text NOT NULL,
	"statement_month" text NOT NULL,
	"total_funds_received_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"closing_cash_book_balance_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cash_book_withdrawals_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"bank_statement_withdrawals_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"additions_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"deductions_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"reconciliation_total_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"difference_nu" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"prepared_by" integer NOT NULL REFERENCES "users"("id"),
	"prepared_at" timestamptz DEFAULT now() NOT NULL,
	"updated_by" integer NOT NULL REFERENCES "users"("id"),
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"closed_by" integer REFERENCES "users"("id"),
	"closed_at" timestamptz,
	CONSTRAINT "bank_reconciliations_status_check" CHECK ("status" in ('Draft','Reconciled','Closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "bank_reconciliations_period_unique" ON "bank_reconciliations" ("fiscal_year","account_number","statement_month");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_fiscal_year_month_idx" ON "bank_reconciliations" ("fiscal_year","statement_month");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_status_idx" ON "bank_reconciliations" ("status");

CREATE TABLE IF NOT EXISTS "bank_reconciliation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"reconciliation_id" integer NOT NULL REFERENCES "bank_reconciliations"("id") ON DELETE cascade,
	"item_type" text NOT NULL,
	"transaction_date" text,
	"reference" text DEFAULT '' NOT NULL,
	"particulars" text NOT NULL,
	"amount_nu" numeric(14, 2) NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "bank_reconciliation_items_type_check" CHECK ("item_type" in ('add','less'))
);
CREATE INDEX IF NOT EXISTS "bank_reconciliation_items_reconciliation_idx" ON "bank_reconciliation_items" ("reconciliation_id","item_type");

CREATE TABLE IF NOT EXISTS "month_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"account_number" text NOT NULL,
	"close_month" text NOT NULL,
	"status" text DEFAULT 'Closed' NOT NULL,
	"closed_by" integer NOT NULL REFERENCES "users"("id"),
	"closed_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "month_closures_period_unique" ON "month_closures" ("fiscal_year","account_number","close_month");
CREATE INDEX IF NOT EXISTS "month_closures_fiscal_year_month_idx" ON "month_closures" ("fiscal_year","close_month");
