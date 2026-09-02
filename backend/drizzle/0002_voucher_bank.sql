-- 0002: payee bank details on vouchers.
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "payee_account_number" text;
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "payee_bank_name" text;