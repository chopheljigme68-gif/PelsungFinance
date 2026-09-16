"use client";

import { useMemo, useState } from "react";
import { Empty } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { currentBhutanMonth, fiscalYearLabel, fiscalYearMonthOptions, money, payMonthLabel, roundNu, timestamp } from "@/lib/format";
import { activeAccountingMonth, cashBookPositionForMonth, type EditableBankReconciliationItem } from "@/lib/reconciliation";
import { OPERATING_BANK_ACCOUNT } from "@/lib/reference";
import { useApp } from "@/providers/app-provider";
import type { AccountingData, BankReconciliation } from "@/types";

/* -------------------------------------------------------------------------- */
/* Bank reconciliation                                                        */
/* -------------------------------------------------------------------------- */

export function BankReconciliationModule({ data }: { data: AccountingData }) {
  const { fiscalYear, run, can, setNotice } = useApp();
  const canManage = can("manage_bank_reconciliation");
  const { vouchers, bankReconciliations: reconciliations, bankReconciliationItems: reconciliationItems, monthClosures } = data;

  // Roll forward past closed months: once September is closed, October is active.
  const activeMonth = useMemo(() => activeAccountingMonth(fiscalYear, monthClosures), [fiscalYear, monthClosures]);
  const months = useMemo(
    () => fiscalYearMonthOptions(fiscalYear).filter((month) => month.value <= activeMonth),
    [fiscalYear, activeMonth],
  );
  const defaultMonth = months.find((month) => month.value === activeMonth)?.value ?? months.at(-1)?.value ?? "";

  const itemsForRecord = (record?: BankReconciliation): EditableBankReconciliationItem[] =>
    record
      ? reconciliationItems
          .filter((item) => item.reconciliationId === record.id)
          .map((item) => ({
            key: `saved-${item.id}`,
            itemType: item.itemType,
            transactionDate: item.transactionDate ?? "",
            reference: item.reference,
            particulars: item.particulars,
            amountNu: String(item.amountNu),
          }))
      : [];

  const recordFor = (month: string) =>
    reconciliations.find((record) => record.statementMonth === month && record.accountNumber === OPERATING_BANK_ACCOUNT);

  const initialRecord = recordFor(defaultMonth);
  const [statementMonth, setStatementMonth] = useState(defaultMonth);
  const [bankStatementWithdrawalsNu, setBankStatementWithdrawalsNu] = useState(
    initialRecord ? String(initialRecord.bankStatementWithdrawalsNu) : "",
  );
  const [items, setItems] = useState<EditableBankReconciliationItem[]>(itemsForRecord(initialRecord));
  const [saving, setSaving] = useState(false);

  const selectedRecord = recordFor(statementMonth);
  const isReconciled = ["Reconciled", "Closed"].includes(selectedRecord?.status ?? "");
  const liveCashBook = useMemo(() => cashBookPositionForMonth(vouchers, statementMonth), [vouchers, statementMonth]);
  const cashBook =
    isReconciled && selectedRecord
      ? {
          totalFundsReceivedNu: selectedRecord.totalFundsReceivedNu,
          closingCashBookBalanceNu: selectedRecord.closingCashBookBalanceNu,
          cashBookWithdrawalsNu: selectedRecord.cashBookWithdrawalsNu,
        }
      : liveCashBook;

  const selectStatementMonth = (month: string) => {
    const record = recordFor(month);
    setStatementMonth(month);
    setBankStatementWithdrawalsNu(record ? String(record.bankStatementWithdrawalsNu) : "");
    setItems(itemsForRecord(record));
  };

  const additionsNu = roundNu(
    items.filter((item) => item.itemType === "add").reduce((sum, item) => sum + (Number(item.amountNu) || 0), 0),
  );
  const deductionsNu = roundNu(
    items.filter((item) => item.itemType === "less").reduce((sum, item) => sum + (Number(item.amountNu) || 0), 0),
  );
  const statementWithdrawalsNu = Number(bankStatementWithdrawalsNu) || 0;
  const reconciliationTotalNu = roundNu(statementWithdrawalsNu + additionsNu - deductionsNu);
  const differenceNu = roundNu(cashBook.cashBookWithdrawalsNu - reconciliationTotalNu);

  const addItem = (itemType: "add" | "less") =>
    setItems((current) => [
      ...current,
      { key: `${itemType}-${Date.now()}-${current.length}`, itemType, transactionDate: "", reference: "", particulars: "", amountNu: "" },
    ]);
  const updateItem = (
    key: string,
    field: keyof Omit<EditableBankReconciliationItem, "key" | "itemType">,
    value: string,
  ) => setItems((current) => current.map((item) => (item.key === key ? { ...item, [field]: value } : item)));
  const removeItem = (key: string) => setItems((current) => current.filter((item) => item.key !== key));
  const resetSelectedMonth = () => {
    setBankStatementWithdrawalsNu(selectedRecord ? String(selectedRecord.bankStatementWithdrawalsNu) : "");
    setItems(itemsForRecord(selectedRecord));
  };

  const save = async (reconcile: boolean) => {
    if (reconcile && bankStatementWithdrawalsNu.trim() === "") {
      setNotice("Enter the fund withdrawn as per the bank statement.");
      return;
    }
    if (!Number.isFinite(Number(bankStatementWithdrawalsNu)) || Number(bankStatementWithdrawalsNu) < 0) {
      setNotice("Enter a valid fund withdrawn amount from the bank statement.");
      return;
    }
    if (items.some((item) => !item.particulars.trim() || !Number.isFinite(Number(item.amountNu)) || Number(item.amountNu) <= 0)) {
      setNotice("Complete the particulars and a positive amount for every Annex entry.");
      return;
    }
    if (reconcile && differenceNu !== 0) {
      setNotice(`The reconciliation difference must be zero before the statement can be reconciled. Current difference: ${money.format(differenceNu)}.`);
      return;
    }
    if (
      reconcile &&
      !window.confirm(`Reconcile the bank statement for ${payMonthLabel(statementMonth)}? The completed statement will then be available to Month Close.`)
    )
      return;

    setSaving(true);
    await run(
      () =>
        api.saveBankReconciliation({
          fiscalYear,
          accountNumber: OPERATING_BANK_ACCOUNT,
          statementMonth,
          bankStatementWithdrawalsNu: roundNu(Number(bankStatementWithdrawalsNu)),
          reconcile,
          items: items.map((item) => ({
            itemType: item.itemType,
            transactionDate: item.transactionDate,
            reference: item.reference.trim(),
            particulars: item.particulars.trim(),
            amountNu: roundNu(Number(item.amountNu)),
          })),
        }),
      reconcile
        ? `${payMonthLabel(statementMonth)} was reconciled.`
        : `${payMonthLabel(statementMonth)} reconciliation was saved as a draft.`,
    );
    setSaving(false);
  };

  const renderItems = (itemType: "add" | "less") => {
    const visibleItems = items.filter((item) => item.itemType === itemType);
    return (
      <div className="reconciliation-annex">
        <div className="reconciliation-annex-toolbar">
          <div>
            <strong>{itemType === "add" ? "Annex-1 additions" : "Annex-2 deductions"}</strong>
            <small>
              {itemType === "add"
                ? "Debited in cash book but not yet in bank statement"
                : "Debited in bank statement but not in cash book"}
            </small>
          </div>
          {canManage && !isReconciled && (
            <button type="button" onClick={() => addItem(itemType)}>
              ＋ Add line
            </button>
          )}
        </div>
        {visibleItems.length ? (
          <div className="table-scroll">
            <table className="reconciliation-annex-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Particulars</th>
                  <th className="amount-cell">Amount</th>
                  {canManage && !isReconciled && <th />}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.key}>
                    <td>
                      <input
                        type="date"
                        value={item.transactionDate}
                        disabled={!canManage || isReconciled}
                        onChange={(event) => updateItem(item.key, "transactionDate", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={item.reference}
                        maxLength={80}
                        disabled={!canManage || isReconciled}
                        placeholder="Cheque / reference"
                        onChange={(event) => updateItem(item.key, "reference", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={item.particulars}
                        maxLength={240}
                        disabled={!canManage || isReconciled}
                        placeholder="Enter particulars"
                        onChange={(event) => updateItem(item.key, "particulars", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="amount-input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.amountNu}
                        disabled={!canManage || isReconciled}
                        placeholder="0"
                        onChange={(event) => updateItem(item.key, "amountNu", event.target.value)}
                      />
                    </td>
                    {canManage && !isReconciled && (
                      <td>
                        <button
                          type="button"
                          className="reconciliation-remove"
                          aria-label="Remove adjustment"
                          onClick={() => removeItem(item.key)}
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="reconciliation-no-items">
            No {itemType === "add" ? "Annex-1 additions" : "Annex-2 deductions"} recorded.
          </p>
        )}
      </div>
    );
  };

  const currentBalanceNu = cashBookPositionForMonth(
    vouchers,
    months.at(-1)?.value ?? currentBhutanMonth(),
  ).closingCashBookBalanceNu;

  return (
    <section className="bank-reconciliation-page">
      <div className="reconciliation-page-actions">
        <span className="eyebrow dark">Period control · {fiscalYearLabel(fiscalYear)}</span>
        <button className="secondary-button" onClick={() => window.print()}>
          Print statement
        </button>
      </div>

      <section className="panel reconciliation-account-card">
        <div className="reconciliation-section-bar">
          <span>Account number</span>
          <small>{fiscalYearLabel(fiscalYear)}</small>
        </div>
        <div className="reconciliation-account-fields">
          <label>
            Account No.
            <select value={OPERATING_BANK_ACCOUNT} disabled>
              <option value={OPERATING_BANK_ACCOUNT}>{OPERATING_BANK_ACCOUNT}</option>
            </select>
          </label>
          <div>
            <span>Account name</span>
            <strong>Pelsung Operating Bank Account</strong>
          </div>
          <div>
            <span>Current bank balance</span>
            <strong>{money.format(currentBalanceNu)}</strong>
          </div>
        </div>
      </section>

      <section className="panel reconciliation-register">
        <div className="reconciliation-section-bar">
          <span>Generate Bank Reconciliation Statement</span>
          <small>Select View to open a month</small>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="amount-cell">Fund withdrawn as per cash book</th>
                <th className="amount-cell">Reconciliation total</th>
                <th className="amount-cell">Difference</th>
                <th>Status</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => {
                const record = recordFor(month.value);
                const monthCashBook = ["Reconciled", "Closed"].includes(record?.status ?? "")
                  ? record?.cashBookWithdrawalsNu ?? 0
                  : cashBookPositionForMonth(vouchers, month.value).cashBookWithdrawalsNu;
                const displayStatus = record?.status === "Closed" ? "Reconciled" : record?.status;
                return (
                  <tr key={month.value} className={statementMonth === month.value ? "selected-reconciliation-row" : ""}>
                    <td>
                      <strong>{month.label}</strong>
                    </td>
                    <td className="amount-cell">{money.format(monthCashBook)}</td>
                    <td className="amount-cell">{record ? money.format(record.reconciliationTotalNu) : "—"}</td>
                    <td className="amount-cell">{record ? money.format(record.differenceNu) : "—"}</td>
                    <td>
                      {record ? (
                        <span className={`status-chip status-${displayStatus?.toLocaleLowerCase()}`}>{displayStatus}</span>
                      ) : (
                        <span className="reconciliation-not-started">Not started</span>
                      )}
                    </td>
                    <td>
                      <button className="table-link-button" onClick={() => selectStatementMonth(month.value)}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!months.length && (
                <tr>
                  <td colSpan={6}>
                    <Empty message={`No current or past month is available in ${fiscalYearLabel(fiscalYear)}.`} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {months.length ? (
        <section className="panel reconciliation-workbook">
          <div className="reconciliation-section-bar">
            <span>Enter / Edit Bank Reconciliation Details</span>
            <small>
              {isReconciled
                ? `Reconciled ${selectedRecord?.closedAt ? new Date(selectedRecord.closedAt).toLocaleDateString("en-BT", { dateStyle: "medium" }) : ""}`
                : canManage
                  ? "Draft entry"
                  : "View only"}
            </small>
          </div>
          <div className="reconciliation-period">
            <label>
              Month
              <select value={statementMonth} onChange={(event) => selectStatementMonth(event.target.value)}>
                {months.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span>Statement status</span>
              <strong className={differenceNu === 0 ? "reconciliation-balanced" : "reconciliation-unbalanced"}>
                {isReconciled
                  ? "Reconciled"
                  : selectedRecord
                    ? differenceNu === 0
                      ? "Balanced draft"
                      : "Difference outstanding"
                    : "Not started"}
              </strong>
            </div>
          </div>
          <div className="reconciliation-block">
            <h3>A. Particulars</h3>
            <div className="reconciliation-calculation-row">
              <span>1. Total funds received</span>
              <strong>{money.format(cashBook.totalFundsReceivedNu)}</strong>
            </div>
            <div className="reconciliation-calculation-row">
              <span>2. Closing balance as per cash book</span>
              <strong>{money.format(cashBook.closingCashBookBalanceNu)}</strong>
            </div>
            <div className="reconciliation-calculation-row reconciliation-emphasis">
              <span>3. Fund withdrawn as per cash book (1 − 2)</span>
              <strong>{money.format(cashBook.cashBookWithdrawalsNu)}</strong>
            </div>
          </div>
          <div className="reconciliation-block">
            <h3>B. Reconciliation</h3>
            <label className="reconciliation-statement-input">
              <span>1. Fund withdrawn as per bank statement</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={bankStatementWithdrawalsNu}
                disabled={!canManage || isReconciled}
                placeholder="Enter bank statement total"
                onChange={(event) => setBankStatementWithdrawalsNu(event.target.value)}
              />
              <small>Nu.</small>
            </label>
            {renderItems("add")}
            <div className="reconciliation-subtotal">
              <span>Total (1 + Annex-1)</span>
              <strong>{money.format(roundNu(statementWithdrawalsNu + additionsNu))}</strong>
            </div>
            {renderItems("less")}
            {canManage && !isReconciled && (
              <div className="reconciliation-annex-save">
                <button className="secondary-button" disabled={saving} onClick={() => void save(false)}>
                  Save annexures
                </button>
              </div>
            )}
            <div className="reconciliation-subtotal reconciliation-total">
              <span>Reconciliation total (1 + Annex-1 − Annex-2)</span>
              <strong>{money.format(reconciliationTotalNu)}</strong>
            </div>
            <div className={`reconciliation-difference ${differenceNu === 0 ? "balanced" : "unbalanced"}`}>
              <div>
                <span>Difference</span>
                <small>Cash book withdrawals less reconciliation total</small>
              </div>
              <strong>{money.format(differenceNu)}</strong>
            </div>
          </div>
          <footer className="reconciliation-footer">
            <div>
              <span>Prepared / updated by</span>
              <strong>{selectedRecord?.updatedByName ?? selectedRecord?.preparedByName ?? "Not saved"}</strong>
              {selectedRecord?.updatedAt && <small>{timestamp(selectedRecord.updatedAt)}</small>}
            </div>
            <div className="reconciliation-footer-actions">
              <button className="secondary-button" onClick={resetSelectedMonth}>
                Refresh
              </button>
              {canManage && !isReconciled && (
                <>
                  <button className="secondary-button" disabled={saving} onClick={() => void save(false)}>
                    Save draft
                  </button>
                  <button
                    className="primary-button"
                    disabled={saving || differenceNu !== 0 || bankStatementWithdrawalsNu.trim() === ""}
                    onClick={() => void save(true)}
                  >
                    Reconcile
                  </button>
                </>
              )}
            </div>
          </footer>
        </section>
      ) : (
        <section className="panel reconciliation-unavailable">
          <Empty message={`Bank reconciliation will become available when ${fiscalYearLabel(fiscalYear)} begins.`} />
        </section>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Month close                                                                */
/* -------------------------------------------------------------------------- */

export function MonthCloseModule({ data }: { data: AccountingData }) {
  const { fiscalYear, run, can } = useApp();
  const canClose = can("manage_month_close");
  const { vouchers, payrollRuns, bankReconciliations: reconciliations, monthClosures } = data;

  const months = useMemo(
    () => fiscalYearMonthOptions(fiscalYear).filter((month) => month.value <= currentBhutanMonth()),
    [fiscalYear],
  );
  const defaultMonth = months.find((month) => month.value === currentBhutanMonth())?.value ?? months.at(-1)?.value ?? "";
  const [closeMonth, setCloseMonth] = useState(defaultMonth);
  const [closing, setClosing] = useState(false);

  const reconciliation = reconciliations.find(
    (item) => item.statementMonth === closeMonth && item.accountNumber === OPERATING_BANK_ACCOUNT,
  );
  const closure = monthClosures.find(
    (item) => item.closeMonth === closeMonth && item.accountNumber === OPERATING_BANK_ACCOUNT,
  );
  const pendingVouchers = vouchers.filter(
    (voucher) => voucher.transactionDate.startsWith(closeMonth) && ["Draft", "Pending"].includes(voucher.status),
  );
  const pendingPayBillPostings = payrollRuns.filter((paybill) => paybill.payMonth === closeMonth && paybill.status === "Finalized");
  const reconciliationComplete = Boolean(
    reconciliation && ["Reconciled", "Closed"].includes(reconciliation.status) && reconciliation.differenceNu === 0,
  );
  const conditions = [
    {
      label: "Monthly reconciliation completed",
      passed: reconciliationComplete,
      detail: reconciliationComplete ? "Reconciled with zero difference" : "Complete Bank Reconciliation first",
    },
    {
      label: "No pending vouchers",
      passed: pendingVouchers.length === 0,
      detail: pendingVouchers.length
        ? `${pendingVouchers.length} draft or pending voucher${pendingVouchers.length === 1 ? "" : "s"}`
        : "All vouchers are cleared",
    },
    {
      label: "No pending pay bill posting",
      passed: pendingPayBillPostings.length === 0,
      detail: pendingPayBillPostings.length
        ? `${pendingPayBillPostings.length} finalized pay bill${pendingPayBillPostings.length === 1 ? "" : "s"} awaiting posting`
        : "All finalized pay bills are posted",
    },
  ];
  const allConditionsPassed = Boolean(closeMonth) && conditions.every((condition) => condition.passed);

  const closeSelectedMonth = async () => {
    if (!allConditionsPassed || closure) return;
    if (
      !window.confirm(
        `Close ${payMonthLabel(closeMonth)} for account ${OPERATING_BANK_ACCOUNT}? New postings and changes will no longer be allowed for this month.`,
      )
    )
      return;
    setClosing(true);
    await run(
      () => api.closeMonth({ fiscalYear, accountNumber: OPERATING_BANK_ACCOUNT, closeMonth }),
      `${payMonthLabel(closeMonth)} was closed successfully.`,
    );
    setClosing(false);
  };

  return (
    <section className="month-close-page">
      <section className="module-hero process-hero">
        <div>
          <span className="eyebrow dark">Period control · {fiscalYearLabel(fiscalYear)}</span>
          <h2>Month Close</h2>
          <p>
            Close an accounting month only after reconciliation, voucher approval and pay bill posting controls have
            passed.
          </p>
        </div>
        <div className="process-summary">
          <span>Closed months</span>
          <strong>{monthClosures.length}</strong>
        </div>
      </section>

      <section className="panel month-close-selection">
        <div className="reconciliation-section-bar">
          <span>Month</span>
          <small>{fiscalYearLabel(fiscalYear)}</small>
        </div>
        <div className="month-close-fields">
          <label>
            Account number
            <select value={OPERATING_BANK_ACCOUNT} disabled>
              <option value={OPERATING_BANK_ACCOUNT}>{OPERATING_BANK_ACCOUNT} · Pelsung Operating Bank Account</option>
            </select>
          </label>
          <label>
            Month
            <select value={closeMonth} onChange={(event) => setCloseMonth(event.target.value)} disabled={!months.length}>
              {months.length ? (
                months.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))
              ) : (
                <option value="">No month available</option>
              )}
            </select>
          </label>
        </div>
      </section>

      {months.length ? (
        <>
          <section className="panel month-close-register">
            <div className="reconciliation-section-bar">
              <span>Close Month by Account Number</span>
              <small>All three controls must pass</small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>A/c No.</th>
                    <th>Not Approved Voucher(s)</th>
                    <th>Pending Pay Bill Posting(s)</th>
                    <th>Account Type</th>
                    <th>Bank Name</th>
                    <th>Branch Name</th>
                    <th>Monthly Reconciliation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(closeMonth)}
                        readOnly
                        aria-label={`Select ${OPERATING_BANK_ACCOUNT}`}
                      />
                    </td>
                    <td>
                      <strong>{OPERATING_BANK_ACCOUNT}</strong>
                    </td>
                    <td>{pendingVouchers.length}</td>
                    <td>{pendingPayBillPostings.length}</td>
                    <td>Operating</td>
                    <td>Bank of Bhutan Ltd.</td>
                    <td>Thimphu Main Branch</td>
                    <td>
                      <span className={`month-control-chip ${reconciliationComplete ? "passed" : "blocked"}`}>
                        {reconciliationComplete ? "Completed" : "Pending"}
                      </span>
                    </td>
                    <td>
                      {closure ? (
                        <span className="status-chip status-closed">Closed</span>
                      ) : allConditionsPassed ? (
                        <span className="month-control-chip passed">Ready to close</span>
                      ) : (
                        <span className="month-control-chip blocked">Action required</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel month-close-controls">
            <div className="month-close-control-heading">
              <div>
                <span className="eyebrow dark">Pre-close controls</span>
                <h3>{payMonthLabel(closeMonth)}</h3>
              </div>
              {closure && (
                <div className="month-closed-by">
                  <span>Closed by</span>
                  <strong>{closure.closedByName ?? "Approving officer"}</strong>
                  <small>{timestamp(closure.closedAt)}</small>
                </div>
              )}
            </div>
            <div className="month-close-condition-list">
              {conditions.map((condition) => (
                <div className={condition.passed ? "passed" : "blocked"} key={condition.label}>
                  <span aria-hidden="true">{condition.passed ? "✓" : "!"}</span>
                  <div>
                    <strong>{condition.label}</strong>
                    <small>{condition.detail}</small>
                  </div>
                </div>
              ))}
            </div>
            <footer className="month-close-footer">
              <p>
                {closure
                  ? "This accounting month is closed."
                  : allConditionsPassed
                    ? "All controls have passed. The month is ready to close."
                    : "Complete every required control before closing the month."}
              </p>
              {canClose && (
                <button
                  className="primary-button"
                  disabled={Boolean(closure) || !allConditionsPassed || closing}
                  onClick={() => void closeSelectedMonth()}
                >
                  {closure ? "Month Closed" : "Close Month"}
                </button>
              )}
            </footer>
          </section>
        </>
      ) : (
        <section className="panel reconciliation-unavailable">
          <Empty message={`Month Close will become available when ${fiscalYearLabel(fiscalYear)} begins.`} />
        </section>
      )}
    </section>
  );
}
