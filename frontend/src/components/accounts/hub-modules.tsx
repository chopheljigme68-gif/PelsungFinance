"use client";

import Link from "next/link";
import { money } from "@/lib/format";
import { OPERATING_BANK_ACCOUNT } from "@/lib/reference";
import { workspaceTotals } from "@/lib/totals";
import type { AccountingData } from "@/types";

/* -------------------------------------------------------------------------- */
/* Accounts hub — Vouchers + Bank Reconciliation                              */
/* -------------------------------------------------------------------------- */

export function AccountsHub({ data }: { data: AccountingData }) {
  const bankBalanceNu = workspaceTotals(data).bankMovement;
  const voucherCount = data.vouchers.length;
  const reconciledMonths = data.bankReconciliations.filter((item) =>
    ["Reconciled", "Closed"].includes(item.status),
  ).length;
  const draftMonths = data.bankReconciliations.filter((item) => item.status === "Draft").length;

  return (
    <>
      <section className="module-hero accounts-hero">
        <div>
          <span className="eyebrow dark">Agency operations</span>
          <h2>Accounts</h2>
          <p>Process vouchers and prepare the monthly reconciliation of Pelsung&apos;s operating bank account.</p>
        </div>
        <div className="accounts-bank-balance">
          <span>Operating bank balance</span>
          <strong>{money.format(bankBalanceNu)}</strong>
          <small>A/C {OPERATING_BANK_ACCOUNT}</small>
        </div>
      </section>

      <section className="accounts-module-grid">
        <Link href="/vouchers">
          <span className="accounts-module-icon">PV</span>
          <div>
            <small>Transaction processing</small>
            <strong>Vouchers</strong>
            <p>Prepare, submit, approve, print and review payment, advance and receipt vouchers.</p>
            <b>
              {voucherCount} voucher{voucherCount === 1 ? "" : "s"} in this financial year →
            </b>
          </div>
        </Link>
        <Link href="/reconciliation">
          <span className="accounts-module-icon">BR</span>
          <div>
            <small>Monthly control</small>
            <strong>Bank Reconciliation Statement</strong>
            <p>Match approved cash-book transactions with the monthly bank statement and record Annex adjustments.</p>
            <b>
              {reconciledMonths} reconciled · {draftMonths} draft →
            </b>
          </div>
        </Link>
      </section>

      <section className="panel accounts-control-note">
        <span>CONTROL</span>
        <div>
          <strong>Monthly bank reconciliation</strong>
          <p>
            Cash-book figures come directly from approved vouchers. Admin and Approving Authority users can enter
            bank-statement figures, save Annexures and reconcile balanced statements.
          </p>
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Process hub — Month Close                                                  */
/* -------------------------------------------------------------------------- */

export function ProcessHub({ data }: { data: AccountingData }) {
  return (
    <>
      <section className="module-hero process-hero">
        <div>
          <span className="eyebrow dark">Period control</span>
          <h2>Process</h2>
          <p>Complete controlled accounting procedures after vouchers, payroll and bank reconciliation are ready.</p>
        </div>
        <div className="process-summary">
          <span>Closed months</span>
          <strong>{data.monthClosures.length}</strong>
        </div>
      </section>

      <section className="accounts-module-grid process-module-grid">
        <Link href="/month-close">
          <span className="accounts-module-icon">MC</span>
          <div>
            <small>Monthly process</small>
            <strong>Month Close</strong>
            <p>
              Close an accounting month only after reconciliation, voucher approval and pay bill posting controls have
              passed.
            </p>
            <b>Open Month Close →</b>
          </div>
        </Link>
      </section>
    </>
  );
}