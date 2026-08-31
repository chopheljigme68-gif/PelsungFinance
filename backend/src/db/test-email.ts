import { env } from "../config/env.js";
import { EmailDeliveryError, closeEmailTransport, sendInvitationEmail, verifyEmailTransport } from "../lib/email.js";

/**
 * Proves email delivery works, without creating a user.
 *
 *   npm run test-email -- you@example.com
 *
 * Sends a real invitation-shaped message carrying a placeholder password, so
 * what lands in the inbox is exactly what a new user would receive. Run this
 * after changing any mail setting: it is far quicker than registering someone
 * and then having to clean the account up.
 */
async function main(): Promise<void> {
  const recipient = process.argv[2]?.trim();

  if (!recipient || !recipient.includes("@")) {
    console.error("Usage: npm run test-email -- <recipient@example.com>");
    process.exitCode = 1;
    return;
  }

  if (env.emailTransport === "none") {
    console.error("Email is not configured.\n");
    console.error("Set ONE of these groups in backend/.env, then run this again:\n");
    console.error("  SMTP   — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL");
    console.error("  Resend — RESEND_API_KEY, RESEND_FROM_EMAIL");
    process.exitCode = 1;
    return;
  }

  console.log(`Transport : ${env.emailTransport}`);
  console.log(`From      : ${env.emailFrom}`);
  if (env.emailTransport === "smtp") {
    console.log(`Server    : ${env.SMTP_HOST}:${env.SMTP_PORT} (${env.SMTP_SECURE || env.SMTP_PORT === 465 ? "TLS" : "STARTTLS"})`);
  }
  console.log(`To        : ${recipient}\n`);

  try {
    // Connect and authenticate first, so a bad password is reported as a bad
    // password rather than as a failed send.
    console.log("Checking the connection…");
    await verifyEmailTransport();
    console.log("Connection accepted.\n");

    console.log("Sending the test invitation…");
    const id = await sendInvitationEmail({
      recipient,
      displayName: "Test Recipient",
      temporaryPassword: "Sample@2026",
      loginUrl: `${env.APP_URL}/login`,
    });

    console.log(`Sent. Provider reference: ${id}\n`);
    console.log(`Check the inbox for ${recipient} — including the spam folder.`);
    console.log("The message shows a User ID and a temporary password; a real invitation");
    console.log("carries the same two fields with a generated password.");
  } catch (error) {
    console.error("\nDelivery failed.\n");
    console.error(error instanceof EmailDeliveryError ? error.message : error);
    process.exitCode = 1;
  }
}

main()
  .then(() => {
    closeEmailTransport();
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error("The test failed unexpectedly:", error instanceof Error ? error.message : error);
    closeEmailTransport();
    process.exit(1);
  });