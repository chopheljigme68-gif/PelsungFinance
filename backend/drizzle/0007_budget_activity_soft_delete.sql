-- Budget activities are soft-deleted: the row stays (so audit history,
-- re-appropriation and supplementary records keep their references) but it
-- disappears from the register, dashboard and every balance check. An Admin
-- can restore it from "Recently deleted".
ALTER TABLE "budget_activities" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "budget_activities" ADD COLUMN IF NOT EXISTS "deleted_by" integer;
--> statement-breakpoint
ALTER TABLE "budget_activities" ADD COLUMN IF NOT EXISTS "delete_reason" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "budget_activities"
    ADD CONSTRAINT "budget_activities_deleted_by_users_id_fk"
    FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_activities_live_idx"
  ON "budget_activities" ("fiscal_year") WHERE "deleted_at" IS NULL;
