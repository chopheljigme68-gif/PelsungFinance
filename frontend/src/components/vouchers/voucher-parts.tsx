"use client";

import { Empty, Status } from "@/components/ui/primitives";
import { money, tableDate } from "@/lib/format";
import type { Voucher } from "@/types";

/** Payroll and remittance vouchers are shown by their function, not their type. */
export const voucherDisplayType = (voucher: Voucher): string => {
  switch (voucher.payrollEntryType) {
    case "gross":
      return "Payroll Gross";
    case "recoveries":
      return "Payroll Recoveries";
    case "net":
      return "Payroll Net Payment";
    case "combined":
      return "Payroll Payment";
    case "tds_hc_remittance":
      return "TDS & HC Remittance";
    case "supplier_tds_remittance":
      return "TDS Remittance";
    default:
      return voucher.voucherType;
  }
};

/** Aggregated payroll and remittance vouchers show their own deduction lines. */
export const showsStandardVoucherDeductions = (voucher: Voucher): boolean =>
  !["combined", "tds_hc_remittance", "supplier_tds_remittance"].includes(voucher.payrollEntryType ?? "");

export function VoucherAmountSummary({ voucher }: { voucher: Voucher }) {
  if (voucher.payrollEntryType === "combined") {
    return (
      <>
        <strong>{money.format(voucher.amountNu)}</strong>
        <small>
          Net Pay {money.format(voucher.netPaymentNu)}
          <br />
          Recoveries {money.format(voucher.tdsNu + voucher.payrollHealthContributionNu + voucher.advanceRecoveryNu)}
        </small>
      </>
    );
  }
  if (["tds_hc_remittance", "supplier_tds_remittance"].includes(voucher.payrollEntryType ?? "")) {
    return <strong>{money.format(voucher.amountNu)}</strong>;
  }

  const hasDeductions = voucher.voucherType === "Payment" && (voucher.tdsNu > 0 || voucher.advanceRecoveryNu > 0);
  return (
    <>
      <strong>{money.format(voucher.amountNu)}</strong>
      {hasDeductions && (
        <small>
          Net {money.format(voucher.netPaymentNu)}
          <br />
          Deductions {money.format(voucher.tdsNu + voucher.advanceRecoveryNu)}
        </small>
      )}
    </>
  );
}

export function PayrollRecoveryBreakdown({ voucher }: { voucher: Voucher }) {
  if (voucher.payrollEntryType !== "combined") return null;
  return (
    <small>
      Salary TDS {money.format(voucher.tdsNu)} · Health Contribution {money.format(voucher.payrollHealthContributionNu)} ·
      Advance {money.format(voucher.advanceRecoveryNu)} · Net Pay {money.format(voucher.netPaymentNu)}
    </small>
  );
}

export function SupplierTdsSourceVouchers({ voucher }: { voucher: Voucher }) {
  if (voucher.payrollEntryType !== "supplier_tds_remittance" || !voucher.supplierTdsSourceVoucherNumbers) return null;
  return (
    <small>
      <b>Included supplier vouchers:</b> {voucher.supplierTdsSourceVoucherNumbers}
    </small>
  );
}

/** Which account a voucher charges — a budget activity, or a control account. */
export function VoucherAccount({ voucher }: { voucher: Voucher }) {
  if ((voucher.payrollEntryType === "gross" || voucher.payrollEntryType === "combined") && voucher.activityId) {
    return (
      <>
        <span className="obc-code">{voucher.obc}</span> {voucher.activity}
        <small>Department payroll · Budget activity</small>
      </>
    );
  }
  if (voucher.supplierTdsRemittanceRunId) {
    return (
      <>
        <span className="obc-code">TDS-REMIT</span> {voucher.supplierTdsRate}% TDS Remittance
        <small>No budget impact · Tax control</small>
      </>
    );
  }
  if (voucher.payrollRunId || voucher.payrollRemittanceRunId) {
    return (
      <>
        <span className="obc-code">{voucher.obc}</span> {voucher.activity}
        <small>No budget impact · Payroll control</small>
      </>
    );
  }
  if (voucher.voucherType === "Receipt") {
    return (
      <>
        <span className="obc-code">FUND-REC</span> Fund Received from {voucher.payee}
        <small>Bank increase · No budget impact</small>
      </>
    );
  }
  if (voucher.voucherType === "Advance") {
    return (
      <>
        <span className="obc-code">ADV</span> Advance Receivable
        <small>No budget impact</small>
      </>
    );
  }
  if (voucher.budgetLines.length) {
    return (
      <div className="voucher-account-lines">
        {voucher.budgetLines.map((line) => (
          <div key={line.id}>
            <span>
              <b className="obc-code">{line.obc}</b> {line.activity}
            </span>
            <strong>{money.format(line.amountNu)}</strong>
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      <span className="obc-code">{voucher.obc}</span> {voucher.activity}
    </>
  );
}

export function VoucherTable({
  vouchers,
  onPrint,
  onSubmit,
  currentUserId,
  emptyMessage = "No vouchers found.",
}: {
  vouchers: Voucher[];
  onPrint?: (voucher: Voucher) => void;
  onSubmit?: (voucher: Voucher) => void;
  currentUserId?: number;
  emptyMessage?: string;
}) {
  const hasActions = Boolean(onPrint || onSubmit);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Voucher</th>
            <th>Date</th>
            <th>Payee / particulars</th>
            <th>Budget activity / account</th>
            <th className="amount-cell">Gross / Net</th>
            <th>Status</th>
            {hasActions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {vouchers.map((voucher) => {
            // Only the person who generated an automatic Draft may submit it.
            const canSubmit = Boolean(
              onSubmit && voucher.status === "Draft" && voucher.payrollEntryType && voucher.createdBy === currentUserId,
            );
            return (
              <tr key={voucher.id}>
                <td>
                  <strong className="voucher-number">{voucher.voucherNumber}</strong>
                  <small>{voucherDisplayType(voucher)}</small>
                </td>
                <td>{tableDate(voucher.transactionDate)}</td>
                <td>
                  <strong>{voucher.payee}</strong>
                  {voucher.tpn && <small>TPN: {voucher.tpn}</small>}
                  <small>{voucher.description}</small>
                  {voucher.billReference && <small>Reference: {voucher.billReference}</small>}
                  <PayrollRecoveryBreakdown voucher={voucher} />
                  <SupplierTdsSourceVouchers voucher={voucher} />
                  {showsStandardVoucherDeductions(voucher) && voucher.tdsNu > 0 && (
                    <small>
                      {voucher.tdsRate}% TDS: {money.format(voucher.tdsNu)}
                    </small>
                  )}
                  {showsStandardVoucherDeductions(voucher) && voucher.advanceRecoveryNu > 0 && (
                    <small>Advance recovery: {money.format(voucher.advanceRecoveryNu)}</small>
                  )}
                  {voucher.status === "Reversed" && (
                    <small className="reversal-detail">Reversal: {voucher.reversalReason}</small>
                  )}
                </td>
                <td>
                  <VoucherAccount voucher={voucher} />
                </td>
                <td className="amount-cell">
                  <VoucherAmountSummary voucher={voucher} />
                </td>
                <td>
                  <Status status={voucher.status} />
                  {voucher.status === "Reversed" && <small>{voucher.reversedByName ?? "Authorised approver"}</small>}
                </td>
                {hasActions && (
                  <td>
                    <div className="voucher-action-stack">
                      {onPrint && (
                        <button type="button" className="voucher-print-button" onClick={() => onPrint(voucher)}>
                          View / Print
                        </button>
                      )}
                      {canSubmit && (
                        <button type="button" className="voucher-submit-button" onClick={() => onSubmit?.(voucher)}>
                          Submit for Approval
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!vouchers.length && <Empty message={emptyMessage} />}
    </div>
  );
}
