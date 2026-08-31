"use client";

import { useState } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { Empty } from "@/components/ui/primitives";
import { VoucherPrintModal } from "@/components/vouchers/voucher-print-modal";
import {
  PayrollRecoveryBreakdown,
  SupplierTdsSourceVouchers,
  VoucherAccount,
  showsStandardVoucherDeductions,
  voucherDisplayType,
} from "@/components/vouchers/voucher-parts";
import { ApiError, api } from "@/lib/api";
import { money } from "@/lib/format";
import { useApp } from "@/providers/app-provider";
import type { AccountingData, Voucher } from "@/types";

export default function ApprovalsPage() {
  return <RouteGuard permission="approve_voucher">{(data) => <ApprovalQueue data={data} />}</RouteGuard>;
}

function ApprovalQueue({ data }: { data: AccountingData }) {
  const { fiscalYear, run, setNotice } = useApp();
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);

  const pending = data.vouchers.filter((voucher) => voucher.status === "Pending");
  const approved = data.vouchers.filter((voucher) => voucher.status === "Approved");

  /** Approve or return, explaining the effect the decision had. */
  const decide = async (voucher: Voucher, status: "Approved" | "Rejected") => {
    await run(
      () => api.decideVoucher(voucher.id, status, fiscalYear),
      status === "Approved" ? approvalMessage(voucher) : "Voucher returned successfully. The available budget balance is unchanged.",
      {
        onSuccess: (snapshot) => {
          // Approving a combined payroll voucher emails every payslip; report
          // the delivery result alongside the approval message.
          const delivery = snapshot.payrollPayslipDelivery;
          if (!delivery) return;
          setNotice(
            `${approvalMessage(voucher)} Payslip email delivery: ${delivery.sent} sent${
              delivery.failed ? `, ${delivery.failed} failed` : ""
            }${delivery.skipped ? `, ${delivery.skipped} skipped` : ""}.`,
          );
        },
        onError: (error: ApiError) => {
          if (error.availableBalanceNu === null) return;
          return `${error.message}\n\nAvailable balance: ${money.format(Math.max(error.availableBalanceNu, 0))}\nAllocation amount: ${money.format(error.expenditureAmountNu ?? voucher.amountNu)}`;
        },
      },
    );
  };

  /** Reversal keeps the original entry and records why it was undone. */
  const reverse = async (voucher: Voucher) => {
    const isAdvance = voucher.voucherType === "Advance";
    const isFundReceipt = voucher.voucherType === "Receipt";
    const isSupplierTdsRemittance = voucher.payrollEntryType === "supplier_tds_remittance";

    const reversalReason = window
      .prompt(
        `Enter the reason for reversing ${voucher.voucherNumber}. This reason will appear in the ${
          isAdvance ? "outstanding advances report" : isFundReceipt ? "receipts and payments report" : "expenditure report"
        } and audit trail.`,
      )
      ?.trim();
    if (reversalReason === undefined) return;
    if (reversalReason.length < 5) {
      window.alert("Enter a reversal reason of at least 5 characters.");
      return;
    }

    const confirmed = window.confirm(
      isAdvance
        ? `Reverse approved advance ${voucher.voucherNumber}? The bank impact will be reversed and it will be removed from outstanding advances. The budget will remain unchanged.`
        : isFundReceipt
          ? `Reverse approved fund receipt ${voucher.voucherNumber}? The receipt will be removed from the bank balance. The budget will remain unchanged.`
          : isSupplierTdsRemittance
            ? `Reverse approved TDS Remittance ${voucher.voucherNumber}? Its bank impact will be reversed and the source deductions will become available for remittance again. The budget will remain unchanged.`
            : `Reverse approved voucher ${voucher.voucherNumber}? The amount ${money.format(voucher.amountNu)} will be restored to the available budget.`,
    );
    if (!confirmed) return;

    await run(
      () => api.reverseVoucher(voucher.id, reversalReason, fiscalYear),
      isAdvance
        ? `${voucher.voucherNumber} was reversed. Its bank impact was reversed and it is no longer outstanding; the budget remains unchanged.`
        : isFundReceipt
          ? `${voucher.voucherNumber} was reversed. The fund receipt was removed from the bank balance; the budget remains unchanged.`
          : isSupplierTdsRemittance
            ? `${voucher.voucherNumber} was reversed. The supplier TDS deductions are available for remittance again; the budget remains unchanged.`
            : `${voucher.voucherNumber} was reversed. The amount was restored to the available balance and the reversal is shown in the expenditure report.`,
    );
  };

  return (
    <>
      <section className="approval-list">
        <header className="section-intro">
          <div>
            <h2>Items requiring action</h2>
            <p>Review the documents, deductions and, for expenditure vouchers, the available budget before approving.</p>
          </div>
          <span>{pending.length} pending</span>
        </header>
        {pending.map((voucher) => (
          <article className="approval-card" key={voucher.id}>
            <div className="approval-icon">{voucher.voucherNumber.split(".")[0]}</div>
            <div className="approval-main">
              <span>
                {voucher.voucherNumber} · {voucher.transactionDate}
              </span>
              <h3>{voucher.payee}</h3>
              {voucher.tpn && <small>TPN: {voucher.tpn}</small>}
              <p>{voucher.description}</p>
              {voucher.billReference && <small>GRN/Bill: {voucher.billReference}</small>}
              <PayrollRecoveryBreakdown voucher={voucher} />
              <SupplierTdsSourceVouchers voucher={voucher} />
              {showsStandardVoucherDeductions(voucher) && voucher.tdsNu > 0 && (
                <small>
                  <b>{voucher.tdsRate}% TDS</b> {money.format(voucher.tdsNu)} · Net payment{" "}
                  {money.format(voucher.netPaymentNu)}
                </small>
              )}
              {showsStandardVoucherDeductions(voucher) && voucher.advanceRecoveryNu > 0 && (
                <small>
                  <b>Advance recovery</b> {money.format(voucher.advanceRecoveryNu)} against{" "}
                  {voucher.advanceRecoveryVoucherNumber}
                </small>
              )}
              <div className="approval-account">
                <VoucherAccount voucher={voucher} />
              </div>
            </div>
            <strong>{money.format(voucher.amountNu)}</strong>
            <div className="approval-actions">
              <button className="voucher-print-button" onClick={() => setPrintVoucher(voucher)}>
                View / Print
              </button>
              <button className="reject-button" onClick={() => void decide(voucher, "Rejected")}>
                Return
              </button>
              <button className="approve-button" onClick={() => void decide(voucher, "Approved")}>
                Approve
              </button>
            </div>
          </article>
        ))}
        {!pending.length && (
          <div className="panel">
            <Empty message="Approval queue is clear." />
          </div>
        )}
      </section>

      <section className="approval-list reversal-list">
        <header className="section-intro">
          <div>
            <h2>Approved voucher reversals</h2>
            <p>
              Reverse an approved voucher with a mandatory reason. Accounting and bank effects remain traceable in the
              applicable report.
            </p>
          </div>
          <span>{approved.length} eligible</span>
        </header>
        {approved.map((voucher) => (
          <article className="approval-card reversal-card" key={voucher.id}>
            <div className="approval-icon">↺</div>
            <div className="approval-main">
              <span>{voucher.voucherNumber} · Approved</span>
              <h3>{voucher.payee}</h3>
              {voucher.tpn && <small>TPN: {voucher.tpn}</small>}
              <p>{voucher.description}</p>
              {voucher.billReference && <small>GRN/Bill: {voucher.billReference}</small>}
              <PayrollRecoveryBreakdown voucher={voucher} />
              {showsStandardVoucherDeductions(voucher) && voucher.tdsNu > 0 && (
                <small>
                  <b>{voucher.tdsRate}% TDS</b> {money.format(voucher.tdsNu)} · Net payment{" "}
                  {money.format(voucher.netPaymentNu)}
                </small>
              )}
              {showsStandardVoucherDeductions(voucher) && voucher.advanceRecoveryNu > 0 && (
                <small>
                  <b>Advance recovery</b> {money.format(voucher.advanceRecoveryNu)} against{" "}
                  {voucher.advanceRecoveryVoucherNumber}
                </small>
              )}
              <div className="approval-account">
                <VoucherAccount voucher={voucher} />
              </div>
            </div>
            <strong>{money.format(voucher.amountNu)}</strong>
            <div className="approval-actions">
              <button className="voucher-print-button" onClick={() => setPrintVoucher(voucher)}>
                View / Print
              </button>
              <button className="reversal-button" onClick={() => void reverse(voucher)}>
                Reverse voucher
              </button>
            </div>
          </article>
        ))}
        {!approved.length && (
          <div className="panel compact-empty">
            <Empty message="No approved vouchers are eligible for reversal." />
          </div>
        )}
      </section>

      {printVoucher && (
        <VoucherPrintModal
          voucher={printVoucher}
          activity={data.activities.find((activity) => activity.id === printVoucher.activityId)}
          onClose={() => setPrintVoucher(null)}
        />
      )}
    </>
  );
}

/** Approval messages explain exactly what the decision moved. */
function approvalMessage(voucher: Voucher): string {
  if (voucher.payrollRunId || voucher.payrollRemittanceRunId || voucher.supplierTdsRemittanceRunId) {
    if (voucher.payrollEntryType === "gross" || voucher.payrollEntryType === "combined") {
      return `${voucherDisplayType(voucher)} ${voucher.voucherNumber} was approved. The department's available budget and the payroll bank payment have been updated.`;
    }
    const effect =
      voucher.payrollEntryType === "net"
        ? "The payroll bank payment is now reflected."
        : ["tds_hc_remittance", "supplier_tds_remittance"].includes(voucher.payrollEntryType ?? "")
          ? "The remittance bank payment is now reflected."
          : "The payroll recovery control entry is now reflected.";
    return `${voucherDisplayType(voucher)} ${voucher.voucherNumber} was approved. ${effect} The budget is unchanged.`;
  }
  if (voucher.voucherType === "Advance") {
    return "Advance approved successfully. It has reduced the bank position and is now listed as outstanding; the budget is unchanged.";
  }
  if (voucher.voucherType === "Receipt") {
    return `Fund receipt approved successfully. The fund received from ${voucher.payee} has increased the bank balance; the approved budget is unchanged.`;
  }
  return "Voucher approved successfully. The available budget balance has been updated.";
}
