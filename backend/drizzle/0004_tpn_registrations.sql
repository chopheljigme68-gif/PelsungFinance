-- TPN registry: taxpayer numbers picked when a voucher carries TDS.
CREATE TABLE IF NOT EXISTS "tpn_registrations" (
  "id" serial PRIMARY KEY NOT NULL,
  "tpn" text NOT NULL,
  "name" text NOT NULL,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tpn_registrations"
    ADD CONSTRAINT "tpn_registrations_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tpn_registrations_tpn_unique" ON "tpn_registrations" ("tpn");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tpn_registrations_name_idx" ON "tpn_registrations" ("name");
