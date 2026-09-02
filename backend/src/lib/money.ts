import { z } from "zod";
import { MAX_AMOUNT_NU, roundNu } from "../domain/vouchers.js";

/** True when a number has at most 2 decimal places. */
function atMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

const decimalMessage = "Use at most 2 decimal places (chhertum).";

/**
 * A Ngultrum money amount accepted at the API boundary: a number with up to
 * two decimal places, within the system ceiling, normalised to 2 dp so the
 * stored value never carries floating-point noise.
 */
export const moneyPositive = z.coerce
  .number({ message: "Enter an amount." })
  .finite("Enter a valid amount.")
  .positive("Enter a positive amount.")
  .max(MAX_AMOUNT_NU, "That amount is larger than this system records.")
  .refine(atMostTwoDecimals, decimalMessage)
  .transform(roundNu);

/** Same, but allows zero (for optional deductions, arrears, GST). */
export const moneyNonNegative = z.coerce
  .number({ message: "Enter an amount." })
  .finite("Enter a valid amount.")
  .min(0, "Enter zero or a positive amount.")
  .max(MAX_AMOUNT_NU, "That amount is larger than this system records.")
  .refine(atMostTwoDecimals, decimalMessage)
  .transform(roundNu);

/** A money figure the client sends for the server to re-verify (may be any sign). */
export const moneyAny = z.coerce
  .number({ message: "Enter an amount." })
  .finite("Enter a valid amount.")
  .max(MAX_AMOUNT_NU, "That amount is larger than this system records.")
  .min(-MAX_AMOUNT_NU, "That amount is larger than this system records.")
  .refine(atMostTwoDecimals, decimalMessage)
  .transform(roundNu);