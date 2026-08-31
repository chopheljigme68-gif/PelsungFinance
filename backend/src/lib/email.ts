import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export type EmailDeliveryFailureCode =
  | "not_configured"
  | "test_sender_restricted"
  | "invalid_api_key"
  | "sender_not_verified"
  | "provider_error";

export class EmailDeliveryError extends Error {
  readonly code: EmailDeliveryFailureCode;

  constructor(message: string, code: EmailDeliveryFailureCode = "provider_error") {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

type InvitationEmail = {
  recipient: string;
  displayName: string;
  temporaryPassword: string;
  loginUrl: string;
};

export type PayrollPayslipEmail = {
  recipient: string;
  employeeNumber: string;
  fullName: string;
  designation: string;
  department: string;
  payMonth: string;
  voucherNumber: string;
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  grossPayNu: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  advanceNu: number;
  recoveriesNu: number;
  netPayNu: number;
  idempotencyKey: string;
};

type ResendResponse = { id?: string; message?: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const payslipNumber = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function nu(value: number): string {
  return `Nu. ${payslipNumber.format(value)}`;
}

function payMonthLabel(payMonth: string): string {
  const [year, month] = payMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type Message = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Deduplicates retries on the provider side. */
  idempotencyKey: string;
};

function requireConfigured(): void {
  if (env.emailTransport === "none") {
    throw new EmailDeliveryError(
      "Email delivery is not configured yet. Set either the SMTP settings or a Resend API key and sender in .env.",
      "not_configured",
    );
  }
}

/* ------------------------------------------------------------------ SMTP */

let transporter: Transporter | null = null;

/**
 * One pooled connection for the process. Built lazily so a system running
 * without email never opens a socket.
 */
function smtpTransport(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST!.trim(),
    port: env.SMTP_PORT,
    // Implicit TLS on 465; STARTTLS is negotiated on 587.
    secure: env.SMTP_SECURE || env.SMTP_PORT === 465,
    auth: env.SMTP_USER?.trim() ? { user: env.SMTP_USER.trim(), pass: env.SMTP_PASSWORD ?? "" } : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    ...(env.SMTP_ALLOW_SELF_SIGNED ? { tls: { rejectUnauthorized: false } } : {}),
  });
  return transporter;
}

/** Turns nodemailer's error codes into something an administrator can act on. */
function describeSmtpFailure(error: unknown): EmailDeliveryError {
  const code = (error as { code?: string })?.code ?? "";
  const responseCode = (error as { responseCode?: number })?.responseCode;
  const detail = error instanceof Error ? error.message : String(error);

  if (code === "EAUTH" || responseCode === 535) {
    return new EmailDeliveryError(
      "The mail server rejected the username or password. For Gmail, use a 16-character App Password rather than the account password.",
      "invalid_api_key",
    );
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    return new EmailDeliveryError(
      `The mail server at ${env.SMTP_HOST}:${env.SMTP_PORT} could not be reached. Check the host, the port and any firewall.`,
    );
  }
  if (responseCode === 550 || responseCode === 553) {
    return new EmailDeliveryError(
      "The mail server refused the sender address. Use a sender the account is allowed to send as.",
      "sender_not_verified",
    );
  }
  logger.error({ err: error }, "SMTP delivery failed");
  return new EmailDeliveryError(`The mail server refused the message: ${detail}`);
}

async function sendViaSmtp(message: Message): Promise<string> {
  const address = env.emailFrom;
  const from = env.SMTP_FROM_NAME.trim() ? `"${env.SMTP_FROM_NAME.trim()}" <${address}>` : address;
  try {
    const info = await smtpTransport().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: `<${message.idempotencyKey}@pelsung-finance>`,
    });
    // A message accepted by the relay but with no recipient is not delivered.
    if (info.accepted.length === 0) {
      throw new EmailDeliveryError(`The mail server did not accept ${message.to} as a recipient.`);
    }
    logger.info({ to: message.to, messageId: info.messageId }, "Email sent via SMTP");
    return info.messageId ?? message.idempotencyKey;
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    throw describeSmtpFailure(error);
  }
}

/* ---------------------------------------------------------------- Resend */

async function postToResend(payload: Record<string, unknown>, idempotencyKey: string, apiKey: string): Promise<ResendResponse & { status: number; ok: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "Pelsung-Finance/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as ResendResponse;
    return { ...result, status: response.status, ok: response.ok };
  } catch (error) {
    logger.error({ err: error }, "Email provider request failed");
    throw new EmailDeliveryError("The email provider could not be reached. Check the network settings and retry.");
  } finally {
    clearTimeout(timeout);
  }
}

async function sendViaResend(message: Message): Promise<string> {
  const apiKey = env.RESEND_API_KEY!.trim();
  const from = env.emailFrom;
  const result = await postToResend(
    { from, to: [message.to], subject: message.subject, text: message.text, html: message.html },
    message.idempotencyKey,
    apiKey,
  );
  if (!result.ok || !result.id) throw describeFailure(result, from);
  logger.info({ to: message.to, id: result.id }, "Email sent via Resend");
  return result.id;
}

/**
 * Sends one message through whichever transport is configured.
 *
 * Returns the provider's message id, which callers store so a delivery can be
 * traced later. Every failure arrives as an `EmailDeliveryError` carrying a
 * message written for an administrator, not a stack trace.
 */
async function deliver(message: Message): Promise<string> {
  requireConfigured();
  return env.emailTransport === "smtp" ? sendViaSmtp(message) : sendViaResend(message);
}

/** Verifies the transport can connect and authenticate, without sending. */
export async function verifyEmailTransport(): Promise<void> {
  requireConfigured();
  if (env.emailTransport !== "smtp") return;
  try {
    await smtpTransport().verify();
  } catch (error) {
    throw describeSmtpFailure(error);
  }
}

/** Closes the pooled SMTP connections so a script can exit cleanly. */
export function closeEmailTransport(): void {
  transporter?.close();
  transporter = null;
}

function describeFailure(result: { status: number; message?: string }, from: string): EmailDeliveryError {
  const providerMessage = result.message?.toLocaleLowerCase() ?? "";
  if (result.status === 403 && (from.toLocaleLowerCase().includes("@resend.dev") || providerMessage.includes("only send testing emails"))) {
    return new EmailDeliveryError(
      "Resend's testing sender can only email the address that owns the Resend account. Verify your domain in Resend and use a verified sender, then retry the invitation.",
      "test_sender_restricted",
    );
  }
  if (providerMessage.includes("api key is invalid") || providerMessage.includes("invalid_api_key")) {
    return new EmailDeliveryError(
      "The Resend API key is invalid or has been revoked. Add a current Resend API key, then retry the invitation.",
      "invalid_api_key",
    );
  }
  if (providerMessage.includes("domain") && providerMessage.includes("not verified")) {
    return new EmailDeliveryError(
      "The email sender domain is not verified in Resend. Verify the domain, then retry the invitation.",
      "sender_not_verified",
    );
  }
  return new EmailDeliveryError(
    "The email provider could not deliver the invitation. Check the verified sender and retry from User Management.",
  );
}

/**
 * The invitation carries the two things the person needs to get in: the user
 * ID they sign in with, and the interim password generated for them. It is the
 * only place that password is ever revealed, so delivery failing is the same
 * as the account being unreachable — callers must surface that, never swallow
 * it.
 */
export async function sendInvitationEmail({
  recipient,
  displayName,
  temporaryPassword,
  loginUrl,
}: InvitationEmail): Promise<string> {
  const safe = {
    name: escapeHtml(displayName),
    recipient: escapeHtml(recipient),
    password: escapeHtml(temporaryPassword),
    loginUrl: escapeHtml(loginUrl),
  };

  return deliver({
    to: recipient,
    idempotencyKey: randomUUID(),
    subject: "Your Pelsung Finance account",
    text: [
      `Hello ${displayName},`,
      "",
      "Your Pelsung Finance account has been created.",
      `User ID: ${recipient}`,
      `Temporary password: ${temporaryPassword}`,
      "",
      `Sign in: ${loginUrl}`,
      "Please change this password after signing in, from Change password in the top bar.",
      "",
      "For your security, do not share this email or password.",
    ].join("\n"),
    html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#16324a;line-height:1.6;max-width:560px">
        <h2 style="color:#0d7768">Welcome to Pelsung Finance</h2>
        <p>Hello ${safe.name},</p>
        <p>Your Pelsung Finance account has been created.</p>
        <div style="padding:16px;border:1px solid #d9e3e8;border-radius:8px;background:#f7fafb">
          <p style="margin:0 0 8px"><strong>User ID:</strong> ${safe.recipient}</p>
          <p style="margin:0"><strong>Temporary password:</strong> <code>${safe.password}</code></p>
        </div>
        <p><a href="${safe.loginUrl}" style="display:inline-block;padding:10px 16px;border-radius:6px;color:#fff;background:#0d7768;text-decoration:none">Sign in to Pelsung Finance</a></p>
        <p>Please change this password after signing in, from <strong>Change password</strong> in the top bar.</p>
        <p style="font-size:12px;color:#647586">For your security, do not share this email or password.</p>
      </div>`,
  });
}

export async function sendPayrollPayslipEmail(payslip: PayrollPayslipEmail): Promise<string> {
  const period = payMonthLabel(payslip.payMonth);
  const safe = {
    name: escapeHtml(payslip.fullName),
    employeeNumber: escapeHtml(payslip.employeeNumber),
    designation: escapeHtml(payslip.designation),
    department: escapeHtml(payslip.department),
    period: escapeHtml(period),
    voucherNumber: escapeHtml(payslip.voucherNumber),
  };

  return deliver({
    to: payslip.recipient,
    idempotencyKey: payslip.idempotencyKey,
    subject: `Pelsung payslip — ${period}`,
    text: [
      `Hello ${payslip.fullName},`,
      "",
      `Your Pelsung payslip for ${period} is ready.`,
      `Employee number: ${payslip.employeeNumber}`,
      `Designation: ${payslip.designation}`,
      `Department: ${payslip.department}`,
      `Payroll voucher: ${payslip.voucherNumber}`,
      "",
      `Basic Pay: ${nu(payslip.basicPayNu)}`,
      `Allowances: ${nu(payslip.allowancesNu)}`,
      `Arrear: ${nu(payslip.arrearNu)}`,
      `Gross Pay: ${nu(payslip.grossPayNu)}`,
      `Tax on Salary: ${nu(payslip.taxOnSalaryNu)}`,
      `Health Contribution: ${nu(payslip.healthContributionNu)}`,
      `Advance Recovery: ${nu(payslip.advanceNu)}`,
      `Total Deductions: ${nu(payslip.recoveriesNu)}`,
      `Net Pay: ${nu(payslip.netPayNu)}`,
      "",
      "This payslip was issued automatically after approval of the payroll voucher.",
      ].join("\n"),
      html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#172b3e;line-height:1.5;max-width:680px;margin:auto">
        <div style="padding:22px 24px;color:#fff;background:#16324a;border-radius:10px 10px 0 0"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Pelsung Finance</div><h2 style="margin:6px 0 0">Payslip · ${safe.period}</h2></div>
        <div style="padding:22px 24px;border:1px solid #d9e3e8;border-top:0;border-radius:0 0 10px 10px">
          <p>Hello <strong>${safe.name}</strong>,</p><p>Your payslip was issued after approval of payroll voucher <strong>${safe.voucherNumber}</strong>.</p>
          <table style="width:100%;margin:18px 0;border-collapse:collapse;font-size:13px"><tbody>
            <tr><td style="padding:7px;border-bottom:1px solid #e3e9ed;color:#647586">Employee number</td><td style="padding:7px;border-bottom:1px solid #e3e9ed;text-align:right;font-weight:700">${safe.employeeNumber}</td></tr>
            <tr><td style="padding:7px;border-bottom:1px solid #e3e9ed;color:#647586">Designation</td><td style="padding:7px;border-bottom:1px solid #e3e9ed;text-align:right;font-weight:700">${safe.designation}</td></tr>
            <tr><td style="padding:7px;border-bottom:1px solid #e3e9ed;color:#647586">Department</td><td style="padding:7px;border-bottom:1px solid #e3e9ed;text-align:right;font-weight:700">${safe.department}</td></tr>
          </tbody></table>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px"><thead><tr><th colspan="2" style="padding:9px;color:#fff;background:#0d7768;text-align:left">Earnings</th></tr></thead><tbody>
            <tr><td style="padding:8px;border:1px solid #d9e3e8">Basic Pay</td><td style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.basicPayNu)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #d9e3e8">Allowances</td><td style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.allowancesNu)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #d9e3e8">Arrear</td><td style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.arrearNu)}</td></tr>
            <tr><th style="padding:8px;border:1px solid #d9e3e8;text-align:left">Gross Pay</th><th style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.grossPayNu)}</th></tr>
          </tbody></table>
          <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th colspan="2" style="padding:9px;color:#fff;background:#8b3d55;text-align:left">Deductions</th></tr></thead><tbody>
            <tr><td style="padding:8px;border:1px solid #d9e3e8">Tax on Salary</td><td style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.taxOnSalaryNu)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #d9e3e8">Health Contribution</td><td style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.healthContributionNu)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #d9e3e8">Advance Recovery</td><td style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.advanceNu)}</td></tr>
            <tr><th style="padding:8px;border:1px solid #d9e3e8;text-align:left">Total Deductions</th><th style="padding:8px;border:1px solid #d9e3e8;text-align:right">${nu(payslip.recoveriesNu)}</th></tr>
          </tbody></table>
          <div style="margin-top:18px;padding:15px 17px;color:#fff;background:#16324a;border-radius:7px"><span style="font-size:12px;text-transform:uppercase;letter-spacing:.08em">Net Pay</span><strong style="float:right;font-size:18px">${nu(payslip.netPayNu)}</strong></div>
          <p style="margin-top:20px;font-size:12px;color:#647586">This payslip was generated automatically by Pelsung Accounting Management System after payroll voucher approval.</p>
        </div>
      </div>`,
  });
}