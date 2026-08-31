CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text DEFAULT '2026-2027' NOT NULL,
	"category" text NOT NULL,
	"financing" text NOT NULL,
	"obc" text NOT NULL,
	"activity" text NOT NULL,
	"budget_type" text NOT NULL,
	"approved_nu" bigint NOT NULL,
	"brief" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_activities_type_check" CHECK ("budget_activities"."budget_type" in ('Current','Capital')),
	CONSTRAINT "budget_activities_approved_check" CHECK ("budget_activities"."approved_nu" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_reappropriations" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"source_activity_id" integer NOT NULL,
	"destination_activity_id" integer NOT NULL,
	"amount_nu" bigint NOT NULL,
	"reason" text NOT NULL,
	"transferred_by" integer NOT NULL,
	"transferred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_reappropriations_amount_check" CHECK ("budget_reappropriations"."amount_nu" > 0),
	CONSTRAINT "budget_reappropriations_distinct_check" CHECK ("budget_reappropriations"."source_activity_id" <> "budget_reappropriations"."destination_activity_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_number" text NOT NULL,
	"cid" text,
	"tpn" text,
	"full_name" text NOT NULL,
	"email" text,
	"designation" text NOT NULL,
	"department" text NOT NULL,
	"basic_pay_nu" bigint DEFAULT 0 NOT NULL,
	"allowances_nu" bigint DEFAULT 0 NOT NULL,
	"arrear_nu" bigint DEFAULT 0 NOT NULL,
	"gross_pay_nu" bigint NOT NULL,
	"tax_on_salary_nu" bigint DEFAULT 0 NOT NULL,
	"health_contribution_nu" bigint DEFAULT 0 NOT NULL,
	"advance_nu" bigint DEFAULT 0 NOT NULL,
	"deductions_nu" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_status_check" CHECK ("employees"."status" in ('Active','Inactive'))
);
--> statement-breakpoint
CREATE TABLE "payroll_remittance_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"pay_month" text NOT NULL,
	"employee_count" integer NOT NULL,
	"tax_on_salary_nu" bigint NOT NULL,
	"health_contribution_nu" bigint NOT NULL,
	"total_remittance_nu" bigint NOT NULL,
	"status" text DEFAULT 'Finalized' NOT NULL,
	"finalized_by" integer NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" integer,
	"posted_at" timestamp with time zone,
	CONSTRAINT "payroll_remittance_runs_status_check" CHECK ("payroll_remittance_runs"."status" in ('Finalized','Posted'))
);
--> statement-breakpoint
CREATE TABLE "payroll_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"employee_number" text NOT NULL,
	"cid" text,
	"tpn" text,
	"full_name" text NOT NULL,
	"email" text,
	"designation" text NOT NULL,
	"department" text NOT NULL,
	"basic_pay_nu" bigint NOT NULL,
	"allowances_nu" bigint NOT NULL,
	"arrear_nu" bigint NOT NULL,
	"gross_pay_nu" bigint NOT NULL,
	"tax_on_salary_nu" bigint NOT NULL,
	"health_contribution_nu" bigint NOT NULL,
	"advance_nu" bigint NOT NULL,
	"recoveries_nu" bigint NOT NULL,
	"net_pay_nu" bigint NOT NULL,
	"payslip_email_id" text,
	"payslip_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"pay_month" text NOT NULL,
	"department" text DEFAULT 'All Departments' NOT NULL,
	"budget_activity_id" integer,
	"employee_count" integer NOT NULL,
	"basic_pay_nu" bigint NOT NULL,
	"allowances_nu" bigint NOT NULL,
	"arrear_nu" bigint NOT NULL,
	"gross_pay_nu" bigint NOT NULL,
	"tax_on_salary_nu" bigint NOT NULL,
	"health_contribution_nu" bigint NOT NULL,
	"advance_nu" bigint NOT NULL,
	"recoveries_nu" bigint NOT NULL,
	"net_pay_nu" bigint NOT NULL,
	"status" text DEFAULT 'Finalized' NOT NULL,
	"finalized_by" integer NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" integer,
	"posted_at" timestamp with time zone,
	"posting_undone_at" timestamp with time zone,
	CONSTRAINT "payroll_runs_status_check" CHECK ("payroll_runs"."status" in ('Finalized','Posted'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplementary_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"activity_id" integer NOT NULL,
	"amount_nu" bigint NOT NULL,
	"reason" text NOT NULL,
	"granted_by" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplementary_budgets_amount_check" CHECK ("supplementary_budgets"."amount_nu" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_tds_remittance_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"remittance_run_id" integer NOT NULL,
	"voucher_id" integer NOT NULL,
	"tds_nu" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_tds_remittance_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" text NOT NULL,
	"pay_month" text NOT NULL,
	"tds_rate" integer NOT NULL,
	"source_voucher_count" integer NOT NULL,
	"total_remittance_nu" bigint NOT NULL,
	"status" text DEFAULT 'Posted' NOT NULL,
	"finalized_by" integer NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_tds_remittance_runs_rate_check" CHECK ("supplier_tds_remittance_runs"."tds_rate" in (2,5)),
	CONSTRAINT "supplier_tds_remittance_runs_status_check" CHECK ("supplier_tds_remittance_runs"."status" in ('Posted','Reversed'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"cid" text,
	"display_name" text NOT NULL,
	"designation" text DEFAULT 'Not assigned' NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"password_iterations" integer NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"invitation_email_id" text,
	"invitation_sent_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('agency_user','agency_admin','approving_authority','viewer'))
);
--> statement-breakpoint
CREATE TABLE "voucher_budget_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"activity_id" integer NOT NULL,
	"amount_nu" bigint NOT NULL,
	CONSTRAINT "voucher_budget_lines_amount_check" CHECK ("voucher_budget_lines"."amount_nu" > 0)
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_number" text NOT NULL,
	"activity_id" integer,
	"fiscal_year" text DEFAULT '2026-2027' NOT NULL,
	"voucher_type" text NOT NULL,
	"payee" text NOT NULL,
	"tpn" text,
	"bill_reference" text,
	"description" text NOT NULL,
	"amount_nu" bigint NOT NULL,
	"gst_nu" bigint DEFAULT 0 NOT NULL,
	"tds_rate" integer DEFAULT 0 NOT NULL,
	"tds_nu" bigint DEFAULT 0 NOT NULL,
	"advance_recovery_nu" bigint DEFAULT 0 NOT NULL,
	"advance_recovery_voucher_id" integer,
	"net_payment_nu" bigint DEFAULT 0 NOT NULL,
	"payroll_run_id" integer,
	"payroll_remittance_run_id" integer,
	"supplier_tds_remittance_run_id" integer,
	"payroll_entry_type" text,
	"payroll_health_contribution_nu" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"transaction_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"reversed_by" integer,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "vouchers_type_check" CHECK ("vouchers"."voucher_type" in ('Payment','Journal','Receipt','Advance')),
	CONSTRAINT "vouchers_status_check" CHECK ("vouchers"."status" in ('Draft','Pending','Approved','Paid','Rejected','Reversed')),
	CONSTRAINT "vouchers_tds_rate_check" CHECK ("vouchers"."tds_rate" in (0,2,5)),
	CONSTRAINT "vouchers_amount_check" CHECK ("vouchers"."amount_nu" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_activities" ADD CONSTRAINT "budget_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reappropriations" ADD CONSTRAINT "budget_reappropriations_source_activity_id_budget_activities_id_fk" FOREIGN KEY ("source_activity_id") REFERENCES "public"."budget_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reappropriations" ADD CONSTRAINT "budget_reappropriations_destination_activity_id_budget_activities_id_fk" FOREIGN KEY ("destination_activity_id") REFERENCES "public"."budget_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reappropriations" ADD CONSTRAINT "budget_reappropriations_transferred_by_users_id_fk" FOREIGN KEY ("transferred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_remittance_runs" ADD CONSTRAINT "payroll_remittance_runs_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_remittance_runs" ADD CONSTRAINT "payroll_remittance_runs_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_budget_activity_id_budget_activities_id_fk" FOREIGN KEY ("budget_activity_id") REFERENCES "public"."budget_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplementary_budgets" ADD CONSTRAINT "supplementary_budgets_activity_id_budget_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."budget_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplementary_budgets" ADD CONSTRAINT "supplementary_budgets_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_tds_remittance_items" ADD CONSTRAINT "supplier_tds_remittance_items_remittance_run_id_supplier_tds_remittance_runs_id_fk" FOREIGN KEY ("remittance_run_id") REFERENCES "public"."supplier_tds_remittance_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_tds_remittance_items" ADD CONSTRAINT "supplier_tds_remittance_items_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_tds_remittance_runs" ADD CONSTRAINT "supplier_tds_remittance_runs_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_budget_lines" ADD CONSTRAINT "voucher_budget_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_budget_lines" ADD CONSTRAINT "voucher_budget_lines_activity_id_budget_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."budget_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_activity_id_budget_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."budget_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_payroll_remittance_run_id_payroll_remittance_runs_id_fk" FOREIGN KEY ("payroll_remittance_run_id") REFERENCES "public"."payroll_remittance_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_supplier_tds_remittance_run_id_supplier_tds_remittance_runs_id_fk" FOREIGN KEY ("supplier_tds_remittance_run_id") REFERENCES "public"."supplier_tds_remittance_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "budget_activities_fiscal_year_idx" ON "budget_activities" USING btree ("fiscal_year");--> statement-breakpoint
CREATE INDEX "budget_activities_year_obc_idx" ON "budget_activities" USING btree ("fiscal_year","obc");--> statement-breakpoint
CREATE INDEX "budget_reappropriations_fiscal_year_date_idx" ON "budget_reappropriations" USING btree ("fiscal_year","transferred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "budget_reappropriations_source_idx" ON "budget_reappropriations" USING btree ("source_activity_id");--> statement-breakpoint
CREATE INDEX "budget_reappropriations_destination_idx" ON "budget_reappropriations" USING btree ("destination_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_unique" ON "departments" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "employees_number_unique" ON "employees" USING btree ("employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_cid_unique" ON "employees" USING btree ("cid");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tpn_unique" ON "employees" USING btree ("tpn");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_unique" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_remittance_runs_month_unique" ON "payroll_remittance_runs" USING btree ("fiscal_year","pay_month");--> statement-breakpoint
CREATE INDEX "payroll_remittance_runs_fiscal_year_idx" ON "payroll_remittance_runs" USING btree ("fiscal_year");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_items_employee_unique" ON "payroll_run_items" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_items_run_idx" ON "payroll_run_items" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_month_department_unique" ON "payroll_runs" USING btree ("fiscal_year","pay_month","department");--> statement-breakpoint
CREATE INDEX "payroll_runs_period_idx" ON "payroll_runs" USING btree ("fiscal_year","pay_month" DESC NULLS LAST,"department");--> statement-breakpoint
CREATE INDEX "payroll_runs_budget_activity_idx" ON "payroll_runs" USING btree ("budget_activity_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "supplementary_budgets_fiscal_year_date_idx" ON "supplementary_budgets" USING btree ("fiscal_year","granted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "supplementary_budgets_activity_idx" ON "supplementary_budgets" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_tds_remittance_items_run_voucher_unique" ON "supplier_tds_remittance_items" USING btree ("remittance_run_id","voucher_id");--> statement-breakpoint
CREATE INDEX "supplier_tds_remittance_items_run_idx" ON "supplier_tds_remittance_items" USING btree ("remittance_run_id");--> statement-breakpoint
CREATE INDEX "supplier_tds_remittance_items_voucher_idx" ON "supplier_tds_remittance_items" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "supplier_tds_remittance_runs_period_idx" ON "supplier_tds_remittance_runs" USING btree ("fiscal_year","pay_month","tds_rate");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_tds_remittance_runs_active_period_unique" ON "supplier_tds_remittance_runs" USING btree ("fiscal_year","pay_month","tds_rate") WHERE status <> 'Reversed';--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_cid_unique" ON "users" USING btree ("cid");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_budget_lines_voucher_activity_unique" ON "voucher_budget_lines" USING btree ("voucher_id","activity_id");--> statement-breakpoint
CREATE INDEX "voucher_budget_lines_voucher_idx" ON "voucher_budget_lines" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_budget_lines_activity_idx" ON "voucher_budget_lines" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_number_unique" ON "vouchers" USING btree ("voucher_number");--> statement-breakpoint
CREATE INDEX "vouchers_activity_idx" ON "vouchers" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "vouchers_fiscal_year_id_idx" ON "vouchers" USING btree ("fiscal_year","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vouchers_advance_recovery_idx" ON "vouchers" USING btree ("advance_recovery_voucher_id");--> statement-breakpoint
CREATE INDEX "vouchers_payroll_run_idx" ON "vouchers" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "vouchers_payroll_remittance_run_idx" ON "vouchers" USING btree ("payroll_remittance_run_id");--> statement-breakpoint
CREATE INDEX "vouchers_supplier_tds_remittance_run_idx" ON "vouchers" USING btree ("supplier_tds_remittance_run_id");--> statement-breakpoint
CREATE INDEX "vouchers_status_idx" ON "vouchers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vouchers_transaction_date_idx" ON "vouchers" USING btree ("transaction_date");