-- 0005: Receipt vouchers (fund / refund / other, into bank or cash) and
-- Direct Transaction (DT) vouchers. Additive: existing vouchers are backfilled
-- to the operating bank ledger, and existing receipts become "Fund receipt",
-- which is exactly how they behaved before.
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "ledger_code" text DEFAULT '1001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "receipt_category" text;
--> statement-breakpoint
UPDATE "vouchers" SET "receipt_category" = 'Fund receipt' WHERE "voucher_type" = 'Receipt' AND "receipt_category" IS NULL;
--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_type_check";
--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_type_check"
  CHECK ("voucher_type" in ('Payment','Journal','Receipt','Advance','DT'));
--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_ledger_code_check";
--> statement-breakpoint
-- Only a receipt may land in cash; every other voucher runs through the bank ledger.
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_ledger_code_check"
  CHECK ("ledger_code" in ('1001','1002') AND ("ledger_code" = '1001' OR "voucher_type" = 'Receipt'));
--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_receipt_category_check";
--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_receipt_category_check"
  CHECK (
    ("voucher_type" = 'Receipt' AND "receipt_category" in ('Fund receipt','Refund','Other receipt'))
    OR ("voucher_type" <> 'Receipt' AND "receipt_category" IS NULL)
  );
