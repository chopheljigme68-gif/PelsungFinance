import "dotenv/config";
import { z } from "zod";

const booleanish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "the Supabase connection string (Settings → Database → Connection string → URI)"),
  DATABASE_SSL: booleanish(true),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  COOKIE_SECURE: booleanish(false),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(168).default(8),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("agency.admin@pelsung.bt"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default("Pelsung Admin"),
  BOOTSTRAP_ADMIN_DESIGNATION: z.string().default("Head of Finance"),
  BOOTSTRAP_ADMIN_CID: z.string().optional(),
  SEED_BUDGET_ACTIVITIES: booleanish(true),

  // Email — configure exactly one transport.
  //
  // Resend: an HTTP API. Simple, but until a domain is verified its shared
  // sender only reaches the address that owns the Resend account.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  // SMTP: any mailbox provider (Gmail with an App Password, Outlook, a
  // corporate relay). Delivers to any recipient with no domain to verify.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** True for implicit TLS on port 465; false for STARTTLS on 587. */
  SMTP_SECURE: booleanish(false),
  /** Sender shown to the recipient. Defaults to SMTP_USER. */
  SMTP_FROM_EMAIL: z.string().optional(),
  SMTP_FROM_NAME: z.string().default("Pelsung Finance"),
  /** Allow a self-signed certificate — only for an internal relay. */
  SMTP_ALLOW_SELF_SIGNED: booleanish(false),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  • ${issue.path.join(".")} — ${issue.message}`).join("\n");
  // On a host there is no .env file to fix; the values come from the
  // platform's own settings, so say that rather than sending the reader to a
  // file that does not exist in the container.
  const where = process.env.RENDER
    ? "Set these in Render → your service → Environment, then redeploy."
    : process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME
      ? "Set these in your hosting platform's environment settings, then redeploy."
      : "Copy .env.example to .env and complete it.";
  // eslint-disable-next-line no-console
  console.error(`\nThe API cannot start — these settings are missing or invalid:\n${issues}\n\n${where}\n`);
  process.exit(1);
}

const raw = parsed.data;

/**
 * SMTP wins when it is configured, because an operator who filled in a mail
 * server meant to use it. Resend is the fallback.
 */
const smtpConfigured = Boolean(raw.SMTP_HOST?.trim() && (raw.SMTP_FROM_EMAIL?.trim() || raw.SMTP_USER?.trim()));
const resendConfigured = Boolean(raw.RESEND_API_KEY?.trim() && raw.RESEND_FROM_EMAIL?.trim());
const emailTransport: "smtp" | "resend" | "none" = smtpConfigured ? "smtp" : resendConfigured ? "resend" : "none";

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  isTest: raw.NODE_ENV === "test",
  corsOrigins: raw.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  sessionTtlSeconds: Math.round(raw.SESSION_TTL_HOURS * 60 * 60),
  emailTransport,
  emailFrom: smtpConfigured
    ? (raw.SMTP_FROM_EMAIL?.trim() || raw.SMTP_USER!.trim())
    : (raw.RESEND_FROM_EMAIL?.trim() ?? ""),
  emailEnabled: emailTransport !== "none",
} as const;

export type Env = typeof env;