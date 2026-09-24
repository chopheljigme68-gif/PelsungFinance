"use client";

import { PelsungLogo } from "@/components/ui/primitives";
import { Portal } from "@/components/ui/portal";
import { money, voucherAmountInWords, voucherDate } from "@/lib/format";
import type { Activity, Voucher } from "@/types";
import { showsStandardVoucherDeductions, voucherDisplayType } from "./voucher-parts";

type AccountRow = {
  broadHead: string;
  account: string;
  objectCode: string;
  debitNu: number | null;
  creditNu: number | null;
};

/**
 * The printable statutory voucher form.
 *
 * The double-entry rows differ by voucher kind, so they are assembled once here
 * and rendered as a single table — the printed form must balance whichever kind
 * it is.
 */
export function VoucherPrintModal({
  voucher,
  activity,
  onClose,
}: {
  voucher: Voucher;
  activity?: Activity;
  onClose: () => void;
}) {
  const isReceipt = voucher.voucherType === "Receipt";
  const isAdvance = voucher.voucherType === "Advance";
  const isPayment = voucher.voucherType === "Payment";
  const isPayroll = Boolean(voucher.payrollEntryType);
  const isBudgetPayroll = ["gross", "combined"].includes(voucher.payrollEntryType ?? "") && Boolean(voucher.activityId);
  const bankEffectNu = voucher.payrollEntryType === "combined" ? voucher.netPaymentNu : voucher.amountNu;
  const formTitle = isPayroll
    ? `${voucherDisplayType(voucher)} Voucher`
    : isReceipt
      ? "Fund Receipt Voucher"
      : voucher.voucherType === "Payment"
        ? "Payment Voucher"
        : `${voucher.voucherType} Voucher`;
  const availableBudgetNu = activity ? activity.approvedNu - activity.committedNu : null;
  const activityAccount = isAdvance
    ? "1102 - Advance Receivable"
    : isReceipt
      ? `3001 - Fund Received from ${voucher.payee}`
      : `${voucher.category} - ${voucher.activity}`;

  const voucherAllocations = voucher.budgetLines.length
    ? voucher.budgetLines
    : activity
      ? [{ ...activity, id: 0, voucherId: voucher.id, activityId: activity.id, amountNu: voucher.amountNu }]
      : [];

  const budgetDebitRows: AccountRow[] = voucherAllocations.map((line) => ({
    broadHead: line.budgetType ?? "Expenditure",
    account: `${line.category} - ${line.activity}`,
    objectCode: line.obc,
    debitNu: line.amountNu,
    creditNu: null,
  }));

  const payrollAccountRows: AccountRow[] =
    voucher.payrollEntryType === "combined"
      ? [
          {
            broadHead: activity?.budgetType ?? "Expenditure",
            account: activityAccount,
            objectCode: voucher.obc,
            debitNu: voucher.amountNu,
            creditNu: null,
          },
          ...(voucher.tdsNu > 0
            ? [{ broadHead: "Liability", account: "2102 - Salary TDS Payable", objectCode: "2102", debitNu: null, creditNu: voucher.tdsNu }]
            : []),
          ...(voucher.payrollHealthContributionNu > 0
            ? [
                {
                  broadHead: "Liability",
                  account: "2103 - Health Contribution Payable",
                  objectCode: "2103",
                  debitNu: null,
                  creditNu: voucher.payrollHealthContributionNu,
                },
              ]
            : []),
          ...(voucher.advanceRecoveryNu > 0
            ? [
                {
                  broadHead: "Recovery",
                  account: "1102 - Employee Advance Receivable",
                  objectCode: "1102",
                  debitNu: null,
                  creditNu: voucher.advanceRecoveryNu,
                },
              ]
            : []),
          {
            broadHead: "Bank",
            account: "1001 - Pelsung Operating Account",
            objectCode: "1001",
            debitNu: null,
            creditNu: voucher.netPaymentNu,
          },
        ]
      : voucher.payrollEntryType === "gross"
        ? [
            {
              broadHead: activity?.budgetType ?? "Expenditure",
              account: activityAccount,
              objectCode: voucher.obc,
              debitNu: voucher.amountNu,
              creditNu: null,
            },
            { broadHead: "Control", account: "2105 - Payroll Clearing", objectCode: "2105", debitNu: null, creditNu: voucher.amountNu },
          ]
        : voucher.payrollEntryType === "recoveries"
          ? [
              { broadHead: "Control", account: "2105 - Payroll Clearing", objectCode: "2105", debitNu: voucher.amountNu, creditNu: null },
              {
                broadHead: "Liability",
                account: "2106 - Payroll Recoveries Payable",
                objectCode: "2106",
                debitNu: null,
                creditNu: voucher.amountNu,
              },
            ]
          : voucher.payrollEntryType === "tds_hc_remittance"
            ? [
                ...(voucher.tdsNu > 0
                  ? [{ broadHead: "Liability", account: "2102 - Salary TDS Payable", objectCode: "2102", debitNu: voucher.tdsNu, creditNu: null }]
                  : []),
                ...(voucher.payrollHealthContributionNu > 0
                  ? [
                      {
                        broadHead: "Liability",
                        account: "2103 - Health Contribution Payable",
                        objectCode: "2103",
                        debitNu: voucher.payrollHealthContributionNu,
                        creditNu: null,
                      },
                    ]
                  : []),
                ...(voucher.tdsNu === 0 && voucher.payrollHealthContributionNu === 0
                  ? [
                      {
                        broadHead: "Liability",
                        account: "2106 - Payroll Recoveries Payable",
                        objectCode: "2106",
                        debitNu: voucher.amountNu,
                        creditNu: null,
                      },
                    ]
                  : []),
                {
                  broadHead: "Bank",
                  account: "1001 - Pelsung Operating Account",
                  objectCode: "1001",
                  debitNu: null,
                  creditNu: voucher.amountNu,
                },
              ]
            : voucher.payrollEntryType === "supplier_tds_remittance"
              ? [
                  {
                    broadHead: "Liability",
                    account: `2102 - ${voucher.supplierTdsRate}% Supplier TDS Payable`,
                    objectCode: "2102",
                    debitNu: voucher.amountNu,
                    creditNu: null,
                  },
                  {
                    broadHead: "Bank",
                    account: "1001 - Pelsung Operating Account",
                    objectCode: "1001",
                    debitNu: null,
                    creditNu: voucher.amountNu,
                  },
                ]
              : [
                  { broadHead: "Control", account: "2105 - Payroll Clearing", objectCode: "2105", debitNu: voucher.amountNu, creditNu: null },
                  {
                    broadHead: "Bank",
                    account: "1001 - Pelsung Operating Account",
                    objectCode: "1001",
                    debitNu: null,
                    creditNu: voucher.amountNu,
                  },
                ];

  const accountRows: AccountRow[] = isPayroll
    ? payrollAccountRows
    : isAdvance
      ? [
          { broadHead: "Asset", account: activityAccount, objectCode: "1102", debitNu: voucher.amountNu, creditNu: null },
          {
            broadHead: "Bank",
            account: `1001 - Pelsung Operating Account - ${voucher.payee}`,
            objectCode: "1001",
            debitNu: null,
            creditNu: voucher.amountNu,
          },
        ]
      : isReceipt
        ? [
            { broadHead: "Bank", account: "1001 - Pelsung Operating Account", objectCode: "1001", debitNu: voucher.amountNu, creditNu: null },
            { broadHead: "Fund", account: activityAccount, objectCode: "3001", debitNu: null, creditNu: voucher.amountNu },
          ]
        : isPayment
          ? [
              ...budgetDebitRows,
              ...(voucher.tdsNu > 0
                ? [
                    {
                      broadHead: "Liability",
                      account: `2102 - ${voucher.tdsRate}% TDS Payable`,
                      objectCode: "2102",
                      debitNu: null,
                      creditNu: voucher.tdsNu,
                    },
                  ]
                : []),
              ...(voucher.advanceRecoveryNu > 0
                ? [
                    {
                      broadHead: "Recovery",
                      account: `1102 - Advance Receivable - ${voucher.advanceRecoveryVoucherNumber ?? "Outstanding advance"}`,
                      objectCode: "1102",
                      debitNu: null,
                      creditNu: voucher.advanceRecoveryNu,
                    },
                  ]
                : []),
              {
                broadHead: "Bank",
                account: `1001 - Pelsung Operating Account - ${voucher.payee}`,
                objectCode: "1001",
                debitNu: null,
                creditNu: voucher.netPaymentNu,
              },
            ]
          : [
              ...budgetDebitRows,
              {
                broadHead: "Payable",
                account: `1001 - Bank / Payable - ${voucher.payee}`,
                objectCode: "1001",
                debitNu: null,
                creditNu: voucher.amountNu,
              },
            ];

  const financingSource = isBudgetPayroll
    ? (activity?.financing ?? "Not recorded")
    : isPayroll
      ? "Payroll control"
      : isAdvance
        ? "Not applicable — advance"
        : isReceipt
          ? `Fund received from ${voucher.payee}`
          : Array.from(new Set(voucherAllocations.map((line) => line.financing))).join(", ") || "Not recorded";

  const bankEffectLabel =
    isReceipt || isAdvance || ["net", "combined", "tds_hc_remittance", "supplier_tds_remittance"].includes(voucher.payrollEntryType ?? "")
      ? "Bank Effect"
      : "Cash Balance";

  return (
    <Portal>
    <div
      className="modal-backdrop voucher-print-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <article className="voucher-print-card" role="dialog" aria-modal="true" aria-label={`${formTitle} ${voucher.voucherNumber}`}>
        <div className="voucher-print-document">
          <header className="voucher-print-topline">
            <p>
              <strong>Printed Date :</strong> {new Date().toLocaleDateString("en-GB")}
              <br />
              {new Date().toLocaleTimeString("en-GB")}
            </p>
            <strong>Voucher Form</strong>
          </header>

          <header className="voucher-print-masthead">
            <div className="voucher-print-logo">
              <PelsungLogo />
            </div>
            <div>
              <h2>PELSUNG</h2>
              <h3>Pelsung Accounting Management System</h3>
              <p>[ {formTitle} ]</p>
            </div>
            <div aria-hidden="true" />
          </header>

          <section className="voucher-print-metadata">
            <dl>
              <div>
                <dt>Bank Account No.</dt>
                <dd>: 110116024748</dd>
              </div>
            </dl>
            <dl>
              <div>
                <dt>Voucher Id.</dt>
                <dd>: {voucher.id}</dd>
              </div>
              <div>
                <dt>Voucher No.</dt>
                <dd>: {voucher.voucherNumber}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>: {voucherDate(voucher.transactionDate)}</dd>
              </div>
              <div>
                <dt>Voucher Status</dt>
                <dd>: {voucher.status}</dd>
              </div>
              <div>
                <dt>Payment Mode</dt>
                <dd>: Bank</dd>
              </div>
            </dl>
          </section>

          <section className="voucher-print-particulars">
            <dl>
              <div>
                <dt>{isReceipt ? "Received From" : "Paid To"}</dt>
                <dd>: {voucher.payee}</dd>
              </div>
              {voucher.tpn && (
                <div>
                  <dt>TPN</dt>
                  <dd>: {voucher.tpn}</dd>
                </div>
              )}
              {voucher.payeeBankName && (
                <div>
                  <dt>Bank</dt>
                  <dd>: {voucher.payeeBankName}</dd>
                </div>
              )}
              {voucher.payeeAccountNumber && (
                <div>
                  <dt>Account No.</dt>
                  <dd>: {voucher.payeeAccountNumber}</dd>
                </div>
              )}
              <div>
                <dt>GRN/Bill No.</dt>
                <dd>: {voucher.billReference || "______________________________"}</dd>
              </div>
              <div>
                <dt>Particulars</dt>
                <dd>: {voucher.description}</dd>
              </div>
              {voucher.payrollEntryType === "combined" && (
                <>
                  <div>
                    <dt>Salary TDS</dt>
                    <dd>: {money.format(voucher.tdsNu)}</dd>
                  </div>
                  <div>
                    <dt>Health Contribution</dt>
                    <dd>: {money.format(voucher.payrollHealthContributionNu)}</dd>
                  </div>
                  <div>
                    <dt>Advance Recovery</dt>
                    <dd>: {money.format(voucher.advanceRecoveryNu)}</dd>
                  </div>
                  <div>
                    <dt>Net Salary Payable</dt>
                    <dd>: {money.format(voucher.netPaymentNu)}</dd>
                  </div>
                </>
              )}
              {voucher.payrollEntryType === "tds_hc_remittance" && (
                <>
                  <div>
                    <dt>Salary TDS Remittance</dt>
                    <dd>: {money.format(voucher.tdsNu)}</dd>
                  </div>
                  <div>
                    <dt>Health Contribution Remittance</dt>
                    <dd>: {money.format(voucher.payrollHealthContributionNu)}</dd>
                  </div>
                </>
              )}
              {voucher.payrollEntryType === "supplier_tds_remittance" && (
                <>
                  <div>
                    <dt>TDS Remittance</dt>
                    <dd>
                      : {voucher.supplierTdsRate}% · {money.format(voucher.amountNu)}
                    </dd>
                  </div>
                  <div>
                    <dt>Included Supplier Vouchers</dt>
                    <dd>: {voucher.supplierTdsSourceVoucherNumbers || "No source vouchers recorded"}</dd>
                  </div>
                </>
              )}
              {showsStandardVoucherDeductions(voucher) && voucher.advanceRecoveryNu > 0 && (
                <div>
                  <dt>Advance Recovery</dt>
                  <dd>
                    : {money.format(voucher.advanceRecoveryNu)} against {voucher.advanceRecoveryVoucherNumber}
                  </dd>
                </div>
              )}
              <div>
                <dt>Financing Source</dt>
                <dd>: {financingSource}</dd>
              </div>
              {voucher.status === "Reversed" && (
                <div>
                  <dt>Reversal Reason</dt>
                  <dd>: {voucher.reversalReason}</dd>
                </div>
              )}
            </dl>
            <dl>
              <div>
                <dt>{bankEffectLabel}</dt>
                <dd>
                  :{" "}
                  {isReceipt
                    ? `+ ${money.format(bankEffectNu)}`
                    : isAdvance ||
                        ["net", "combined", "tds_hc_remittance", "supplier_tds_remittance"].includes(
                          voucher.payrollEntryType ?? "",
                        )
                      ? `− ${money.format(bankEffectNu)}`
                      : "Not applicable"}
                </dd>
              </div>
              <div>
                <dt>Available Budget</dt>
                <dd>
                  :{" "}
                  {isBudgetPayroll
                    ? availableBudgetNu === null
                      ? "Not recorded"
                      : money.format(availableBudgetNu)
                    : isPayroll
                      ? "Not applicable — payroll control"
                      : isAdvance || isReceipt
                        ? "Not applicable — no budget impact"
                        : voucherAllocations.length > 1
                          ? "Multiple activities — see allocation rows"
                          : availableBudgetNu === null
                            ? "Not recorded"
                            : money.format(availableBudgetNu)}
                </dd>
              </div>
            </dl>
          </section>

          <table className="voucher-account-table">
            <thead>
              <tr>
                <th>
                  Exp./Recovery
                  <br />
                  Broad Head
                </th>
                <th>Detailed Account Code &amp; Name</th>
                <th>Object Code</th>
                <th>
                  Debit
                  <br />
                  (Nu.)
                </th>
                <th>
                  Credit
                  <br />
                  (Nu.)
                </th>
              </tr>
            </thead>
            <tbody>
              {accountRows.map((row, index) => (
                <tr key={`${row.objectCode}-${index}`}>
                  <td>{row.broadHead}</td>
                  <td>{row.account}</td>
                  <td>{row.objectCode}</td>
                  <td>{row.debitNu === null ? "" : money.format(row.debitNu)}</td>
                  <td>{row.creditNu === null ? "" : money.format(row.creditNu)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="voucher-print-amounts">
            <p>
              <strong>
                {isReceipt ? "Received Amount" : "Passed for"}
                <br />
                NU. :
              </strong>
              <span>
                {money.format(voucher.amountNu)} ({voucherAmountInWords(voucher.amountNu)})
              </span>
            </p>
            <p>
              <strong>
                {isReceipt ? "Bank Receipt" : "Net Payment"}
                <br />
                NU. :
              </strong>
              <span>
                {money.format(voucher.netPaymentNu)} ({voucherAmountInWords(voucher.netPaymentNu)})
              </span>
            </p>
          </section>

          <section className="voucher-authorization-grid">
            <div>
              <h4>Prepared by:</h4>
              <p>
                <strong>Date.:</strong> {voucherDate(voucher.createdAt ?? voucher.transactionDate)}
              </p>
              <p>
                <strong>Name.:</strong> {voucher.createdByName ?? "________________"}
              </p>
              <p>
                <strong>Designation.:</strong> {voucher.createdByDesignation || "________________"}
              </p>
              <p>
                <strong>CID.:</strong> {voucher.createdByCid ?? "________________"}
              </p>
              <p>
                <strong>Signature.:</strong> __________________
              </p>
            </div>
            <div>
              <h4>Approved by:</h4>
              <p>
                <strong>Date.:</strong> {voucherDate(voucher.approvedAt)}
              </p>
              <p>
                <strong>Name.:</strong> {voucher.approvedByName ?? "________________"}
              </p>
              <p>
                <strong>Designation.:</strong> {voucher.approvedByDesignation || "________________"}
              </p>
              <p>
                <strong>CID.:</strong> {voucher.approvedByCid ?? "________________"}
              </p>
              <p>
                <strong>Signature.:</strong> __________________
              </p>
            </div>
          </section>

          <section className="voucher-payment-receipt">
            <div>
              <strong>{isReceipt ? "Fund Receipt Confirmed" : "Received Payment"}</strong>
              <p>{money.format(voucher.netPaymentNu)}</p>
              <span>Name, Signature &amp; Date.</span>
            </div>
          </section>

          <footer className="voucher-print-footer">
            <span>Generated from Pelsung Accounting Management System</span>
            <span>1/1</span>
          </footer>
        </div>
        <div className="voucher-print-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button" onClick={() => window.print()}>
            Print voucher
          </button>
        </div>
      </article>
    </div>
    </Portal>
  );
}