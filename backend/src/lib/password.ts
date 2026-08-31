import { createHash, pbkdf2, randomBytes, randomInt, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

export const PASSWORD_ITERATIONS = 210_000;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 20;
const KEY_LENGTH_BYTES = 32;
const DIGEST = "sha256";

export type PasswordRecord = {
  hash: string;
  salt: string;
  iterations: number;
};

/**
 * PBKDF2-HMAC-SHA256, hex-encoded. Stored records carry their own iteration
 * count so historic hashes keep verifying after the work factor is raised.
 */
export async function hashPassword(password: string, saltHex: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const derived = await pbkdf2Async(password.normalize("NFC"), Buffer.from(saltHex, "hex"), iterations, KEY_LENGTH_BYTES, DIGEST);
  return derived.toString("hex");
}

export async function createPasswordRecord(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: await hashPassword(password, salt), iterations: PASSWORD_ITERATIONS };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const candidate = await hashPassword(password, record.salt, record.iterations);
  return timingSafeEqual(candidate, record.hash);
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return nodeTimingSafeEqual(leftBuffer, rightBuffer);
}

/** Returns a human-readable reason, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  const normalized = password.normalize("NFC");
  const length = Array.from(normalized).length;
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH) return `Use no more than ${PASSWORD_MAX_LENGTH} characters.`;
  if (!/\p{Lu}/u.test(normalized)) return "Include at least one uppercase letter.";
  if (!/[\p{P}\p{S}]/u.test(normalized)) return "Include at least one special character.";
  return null;
}

export const passwordPolicy = {
  minimumLength: PASSWORD_MIN_LENGTH,
  maximumLength: PASSWORD_MAX_LENGTH,
  unicodeAllowed: true,
  spacesAllowed: true,
  requiresUppercase: true,
  requiresSpecialCharacter: true,
} as const;

/** 12-character invitation password that always satisfies the policy. */
export function generateTemporaryPassword(): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const specials = "!@#$%&*-_?";
  const all = uppercase + lowercase + digits + specials;
  const characters = [uppercase[randomInt(uppercase.length)], specials[randomInt(specials.length)]];
  while (characters.length < 12) characters.push(all[randomInt(all.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

/** Opaque session token; only its SHA-256 digest is stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
