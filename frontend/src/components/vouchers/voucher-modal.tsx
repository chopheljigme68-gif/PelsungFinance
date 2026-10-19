"use client";

import { useId, useState, type FormEvent } from "react";
import { ModalShell, PlusIcon } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api";
import { fiscalYearEndDate, fiscalYearStartDate } from "@/lib/fiscal-year";
import { currentBhutanDate, currentBhutanMonth, fiscalYearLabel, money, roundNu } from "@/lib/format";
import { activeAccountingMonth } from "@/lib/reconciliation";
import { DIRECT_TRANSACTION_ACCOUNT, ledgerAccountName } from "@/lib/ledger";
import { BANKS, BANK_LEDGER_CODE, LEDGER_ACCOUNTS, findLedger } from "@/lib/reference";
import { outstandingAdvanceBalance } from "@/lib/totals";
import {
  RECEIPT_CATEGORIES,
  TPN_PATTERN,
  budgetLineSign,
  calculateVoucherDeductions,
  isPostedStatus,
  receiptCreditsBudget,
  voucherBankEffectNu,
  voucherCashEffectNu,
  type ReceiptCategory,
} from "@/lib/vouchers";
import { useApp } from "@/providers/app-provider";
import type { Activity, MonthClosure, TpnRegistration, Voucher } from "@/types";

/**
 * Default voucher date follows the active accounting month, not the calendar
 * month: once a month is closed, the active month rolls forward (close September
 * → October), so a new voucher opens in October. When the active month is the
 * current calendar month, today's date is used.
 */
const defaultTransactionDate = (fiscalYear: string, activeMonth: string) => {
  const today = currentBhutanDate();
  const withinFy = today >= fiscalYearStartDate(fiscalYear) && today <= fiscalYearEndDate(fiscalYear);
  if (today.slice(0, 7) === activeMonth && withinFy) return today;
  const firstOfActive = `${activeMonth}-01`;
  if (firstOfActive < fiscalYearStartDate(fiscalYear)) return fiscalYearStartDate(fiscalYear);
  if (firstOfActive > fiscalYearEndDate(fiscalYear)) return fiscalYearEndDate(fiscalYear);
  return firstOfActive;
};

type BudgetLineDraft = { key: number; activityId: number; amount: string };

/**
 * Voucher preparation.
 *
 * Payments, journals and direct transactions (DT) are allocated across one or
 * more approved activities and the allocation total *is* the voucher amount. A
 * refund receipt is allocated the same way but credits the activities back.
 * Advances, fund receipts and other receipts take a single amount and touch no
 * budget at all. Receipts land in the bank or cash ledger; a DT names its bank
 * ledger but never moves the system bank balance. Deductions are previewed
 * with the same arithmetic the server applies.
 */
export function VoucherModal({
  activities,
  vouchers,
  tpnRegistrations,
  monthClosures,
  bankBalanceNu,
  cashInHandNu,
  onClose,
}: {
  activities: Activity[];
  vouchers: Voucher[];
  tpnRegistrations: TpnRegistration[];
  monthClosures: MonthClosure[];
  bankBalanceNu: number;
  cashInHandNu: number;
  onClose: () => void;
}) {
  const { fiscalYear, can, run } = useApp();
  // The active accounting month — rolls forward past any closed months.
  const activeMonth = activeAccountingMonth(fiscalYear, monthClosures);
  // When the month has rolled forward (the current month is closed), no date in
  // a closed month may be selected — the earliest allowed date is the 1st of the
  // active month; otherwise the whole fiscal year is open for entry.
  const earliestTransactionDate =
    activeMonth > currentBhutanMonth() ? `${activeMonth}-01` : fiscalYearStartDate(fiscalYear);
  const canPrepareVoucher = can("create_voucher");
  const canRecordFundReceipt = can("record_fund_receipt");

  const [budgetLines, setBudgetLines] = useState<BudgetLineDraft[]>(() => [
    { key: 1, activityId: activities[0]?.id ?? 0, amount: "" },
  ]);
  const [voucherType, setVoucherType] = useState(() =>
    canPrepareVoucher ? (activities.length ? "Payment" : "Advance") : "Receipt",
  );
  const [payee, setPayee] = useState("");
  const [tpn, setTpn] = useState("");
  const [payeeAccountNumber, setPayeeAccountNumber] = useState("");
  const [payeeBankName, setPayeeBankName] = useState("");
  const [billReference, setBillReference] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [gstNu, setGstNu] = useState("0");
  const [tdsRate, setTdsRate] = useState("0");
  const [advanceRecoveryVoucherId, setAdvanceRecoveryVoucherId] = useState("");
  const [advanceRecoveryNu, setAdvanceRecoveryNu] = useState("0");
  const [receiptCategory, setReceiptCategory] = useState<ReceiptCategory>("Fund receipt");
  const [ledgerCode, setLedgerCode] = useState(BANK_LEDGER_CODE);
  const [date, setDate] = useState(() => defaultTransactionDate(fiscalYear, activeMonth));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isAdvance = voucherType === "Advance";
  const isReceipt = voucherType === "Receipt";
  const isPayment = voucherType === "Payment";
  const isDirectTransaction = voucherType === "DT";
  const isRefund = isReceipt && receiptCreditsBudget(receiptCategory);
  const spendsBudget = budgetLineSign(voucherType) === 1;
  const hasNoBudgetImpact = !spendsBudget && !isRefund;
  const choosesLedger = isReceipt || isDirectTransaction;
  // A DT always goes through a bank ledger; only a receipt may land in cash.
  const ledgerOptions = LEDGER_ACCOUNTS.filter((ledger) => isReceipt || ledger.kind === "bank");
  const effectiveLedgerCode = choosesLedger ? ledgerCode : BANK_LEDGER_CODE;
  const selectedLedger = findLedger(effectiveLedgerCode) ?? LEDGER_ACCOUNTS[0];
  const isCashLedger = selectedLedger.kind === "cash";

  const allocationDetails = budgetLines.map((line) => {
    const activity = activities.find((item) => item.id === line.activityId);
    return {
      ...line,
      activity,
      amountNu: Math.max(roundNu(Number(line.amount) || 0), 0),
      availableNu: activity ? activity.approvedNu - activity.committedNu : 0,
      // A refund can give back at most what has been spent on the activity.
      refundableNu: activity ? Math.max(activity.committedNu, 0) : 0,
    };
  });
  const allocatedAmountNu = allocationDetails.reduce((sum, line) => sum + line.amountNu, 0);

  const outstandingAdvances = vouchers
    .filter((voucher) => voucher.voucherType === "Advance" && isPostedStatus(voucher.status))
    .map((voucher) => ({ voucher, outstandingNu: outstandingAdvanceBalance(voucher, vouchers) }))
    .filter((item) => item.outstandingNu > 0);
  const selectedOutstandingAdvance = outstandingAdvances.find(
    (item) => item.voucher.id === Number(advanceRecoveryVoucherId),
  );

  const grossAmountNu = hasNoBudgetImpact ? Math.max(roundNu(Number(amount) || 0), 0) : allocatedAmountNu;
  const gstAmountNu = Math.max(roundNu(Number(gstNu) || 0), 0);
  const recoveryAmountNu =
    isPayment && advanceRecoveryVoucherId ? Math.max(roundNu(Number(advanceRecoveryNu) || 0), 0) : 0;
  const deductionCalculation = calculateVoucherDeductions(
    grossAmountNu,
    gstAmountNu,
    isPayment ? Number(tdsRate) : 0,
    recoveryAmountNu,
  );
  const taxableBaseNu = deductionCalculation.tdsBasisNu;
  const tdsAmountNu = isPayment ? deductionCalculation.tdsNu : 0;
  const netPaymentNu = isPayment ? deductionCalculation.netPaymentNu : grossAmountNu;

  const normalizedTpn = tpn.trim().toLocaleUpperCase();
  const requiresTpn = isPayment && [2, 5].includes(Number(tdsRate));
  // Registered-only: a TDS voucher's TPN must come from the registry.
  const registeredTpns = tpnRegistrations;
  const isRegisteredTpn = registeredTpns.some((registration) => registration.tpn === normalizedTpn);
  const validTpn = !requiresTpn || (TPN_PATTERN.test(normalizedTpn) && isRegisteredTpn);

  const effectVoucher = {
    voucherType,
    amountNu: grossAmountNu,
    netPaymentNu: Math.max(netPaymentNu, 0),
    ledgerCode: effectiveLedgerCode,
  };
  const currentVoucherBankEffectNu = voucherBankEffectNu(effectVoucher);
  const currentVoucherCashEffectNu = voucherCashEffectNu(effectVoucher);
  // A cash receipt is checked against cash in hand; everything else against the bank.
  const balanceName = isCashLedger ? "cash in hand" : "bank balance";
  const currentBalanceNu = isCashLedger ? cashInHandNu : bankBalanceNu;
  const currentVoucherEffectNu = isCashLedger ? currentVoucherCashEffectNu : currentVoucherBankEffectNu;
  const projectedBalanceNu = currentBalanceNu + currentVoucherEffectNu;

  const updateBudgetLine = (key: number, changes: Partial<{ activityId: number; amount: string }>) => {
    setBudgetLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));
    setError("");
  };

  const addBudgetLine = () => {
    const used = new Set(budgetLines.map((line) => line.activityId));
    const nextActivity = activities.find((activity) => !used.has(activity.id));
    if (!nextActivity) return;
    setBudgetLines((current) => [
      ...current,
      { key: Math.max(0, ...current.map((line) => line.key)) + 1, activityId: nextActivity.id, amount: "" },
    ]);
    setError("");
  };

  const removeBudgetLine = (key: number) => {
    setBudgetLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const invalidAllocation = allocationDetails.find((line) => !line.activity || line.amountNu <= 0);
    if (!hasNoBudgetImpact && invalidAllocation) {
      setError(
        isRefund
          ? "Select the budget activity being refunded and enter a positive amount for every line."
          : "Select an approved budget activity and enter a positive amount for every allocation line.",
      );
      return;
    }

    const overRefund = allocationDetails.find((line) => line.amountNu > line.refundableNu);
    if (isRefund && overRefund) {
      setError(
        `${overRefund.activity?.obc ?? "Selected activity"} cannot take a refund of ${money.format(overRefund.amountNu)} because only ${money.format(overRefund.refundableNu)} has been spent on it.`,
      );
      return;
    }

    const overBudgetAllocation = allocationDetails.find((line) => line.amountNu > line.availableNu);
    if (spendsBudget && overBudgetAllocation) {
      setError(
        `${overBudgetAllocation.activity?.obc ?? "Selected activity"} cannot accept ${money.format(overBudgetAllocation.amountNu)} because only ${money.format(overBudgetAllocation.availableNu)} is available.`,
      );
      return;
    }
    if (isPayment && gstAmountNu > grossAmountNu) {
      setError("GST cannot be greater than the gross amount.");
      return;
    }
    if (requiresTpn && !validTpn) {
      setError(
        registeredTpns.length
          ? "Select a registered TPN for the payee before submitting a voucher with 2% or 5% TDS."
          : "No TPN is registered yet. Register the payee under Accounts → TPN Registration first.",
      );
      return;
    }
    if (
      isPayment &&
      recoveryAmountNu > 0 &&
      (!selectedOutstandingAdvance || recoveryAmountNu > selectedOutstandingAdvance.outstandingNu)
    ) {
      setError("Advance recovery cannot be greater than the selected outstanding advance balance.");
      return;
    }
    if (isPayment && netPaymentNu <= 0) {
      setError("Total deductions must be less than the gross amount.");
      return;
    }

    setSaving(true);
    const saved = await run(
      () =>
        api.createVoucher({
          fiscalYear,
          voucherType,
          payee,
          tpn: requiresTpn ? normalizedTpn : null,
          payeeAccountNumber,
          payeeBankName,
          billReference,
          description,
          amountNu: grossAmountNu,
          gstNu: isPayment ? gstAmountNu : 0,
          tdsRate: isPayment ? Number(tdsRate) : 0,
          advanceRecoveryNu: recoveryAmountNu,
          advanceRecoveryVoucherId: recoveryAmountNu > 0 ? Number(advanceRecoveryVoucherId) : null,
          transactionDate: date,
          budgetLines: hasNoBudgetImpact
            ? []
            : allocationDetails.map((line) => ({ activityId: line.activityId, amountNu: line.amountNu })),
          ledgerCode: choosesLedger ? effectiveLedgerCode : null,
          receiptCategory: isReceipt ? receiptCategory : null,
        }),
      isRefund
        ? `Refund submitted for approval. On approval it will increase the ${balanceName} and credit the budget activity back.`
        : isReceipt
          ? `Receipt submitted for approval. It will increase the ${balanceName} only after approval and will not affect the budget.`
          : isDirectTransaction
            ? "Direct transaction submitted for approval. On approval it will update the budget activity; the bank balance is not affected."
            : isAdvance
              ? "Advance submitted for approval. It will affect the bank position only after approval and will not affect the budget."
              : "Voucher submitted for approval.",
      {
        onError: (apiError: ApiError) => {
          // Budget conflicts carry the live balance; show it beside the message.
          if (apiError.availableBalanceNu !== null) {
            const detail = `${apiError.message}\n\nAvailable balance: ${money.format(Math.max(apiError.availableBalanceNu, 0))}\nAllocation amount: ${money.format(apiError.expenditureAmountNu ?? grossAmountNu)}`;
            setError(detail);
            return detail;
          }
          setError(apiError.message);
        },
      },
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <form className="modal-card voucher-entry-card" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Voucher preparation · {fiscalYearLabel(fiscalYear)}</span>
            <h2>{isReceipt ? "Record Receipt" : isDirectTransaction ? "Record Direct Transaction" : "Prepare voucher"}</h2>
            <p>
              {isReceipt
                ? "Record funds received from others — fund releases, cash receipts and refunds — into the bank or cash in hand."
                : isDirectTransaction
                  ? "Record a transaction the bank carried out directly. It is charged to the budget but does not move the system bank balance."
                  : "Enter the same particulars that will appear on the approved printable voucher."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="voucher-system-strip" aria-label="Voucher system details">
          <div>
            <span>{isCashLedger ? "Ledger" : "Bank Account No."}</span>
            <strong>{isCashLedger ? ledgerAccountName(selectedLedger.code) : selectedLedger.accountNumber}</strong>
          </div>
          <div className="voucher-current-bank-balance">
            <span>{isCashLedger ? "Current Cash in Hand" : "Current Bank Balance"}</span>
            <strong>{money.format(currentBalanceNu)}</strong>
          </div>
          <div>
            <span>{isReceipt ? "Received Into" : "Payment Mode"}</span>
            <strong>{isCashLedger ? "Cash" : isDirectTransaction ? "Direct bank transaction" : "Bank"}</strong>
          </div>
          <div>
            <span>Voucher Number</span>
            <strong>Generated on submit</strong>
          </div>
          <div>
            <span>Initial Status</span>
            <strong>Pending</strong>
          </div>
        </section>

        <div className="form-grid">
          <div className="form-section-label wide">Voucher control</div>
          <label>
            Voucher type
            <select
              value={voucherType}
              onChange={(event) => {
                setVoucherType(event.target.value);
                // Cash is a receipt-only ledger; fall back to the bank for anything else.
                if (event.target.value !== "Receipt" && findLedger(ledgerCode)?.kind !== "bank") {
                  setLedgerCode(BANK_LEDGER_CODE);
                }
                setError("");
              }}
            >
              {canPrepareVoucher && <option value="Payment">Payment</option>}
              {canPrepareVoucher && <option value="Journal">Journal</option>}
              {canRecordFundReceipt && <option value="Receipt">Receipt</option>}
              {canPrepareVoucher && <option value="DT">Direct Transaction (DT)</option>}
              {canPrepareVoucher && <option value="Advance">Advance</option>}
            </select>
          </label>
          <label>
            Transaction date
            <input
              type="date"
              min={earliestTransactionDate}
              max={fiscalYearEndDate(fiscalYear)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          {isReceipt && (
            <label>
              Receipt category
              <select
                value={receiptCategory}
                onChange={(event) => {
                  setReceiptCategory(event.target.value as ReceiptCategory);
                  setError("");
                }}
              >
                {RECEIPT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category === "Refund" ? "Refund (credits a budget activity)" : category}
                  </option>
                ))}
              </select>
            </label>
          )}
          {choosesLedger && (
            <label>
              {isReceipt ? "Received into" : "Bank ledger"}
              <select
                value={effectiveLedgerCode}
                onChange={(event) => {
                  setLedgerCode(event.target.value);
                  setError("");
                }}
                required
              >
                {ledgerOptions.map((ledger) => (
                  <option key={ledger.code} value={ledger.code}>
                    {ledger.kind === "bank"
                      ? `${ledger.code} · ${ledger.bankName} A/C ${ledger.accountNumber}`
                      : `${ledger.code} · ${ledger.name}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isAdvance ? (
            <>
              <div className="form-section-label wide">Advance accounting</div>
              <section className="advance-accounting-preview wide" aria-label="Advance accounting treatment">
                <div>
                  <span>Debit account</span>
                  <strong>1102 · Advance Receivable</strong>
                </div>
                <div>
                  <span>Credit account</span>
                  <strong>1001 · Bank</strong>
                </div>
                <div>
                  <span>Budget impact</span>
                  <strong>Nu. 0 · No budget activity</strong>
                </div>
                <div>
                  <span>Bank impact on approval</span>
                  <strong>− {money.format(Math.max(Number(amount) || 0, 0))}</strong>
                </div>
              </section>
            </>
          ) : isReceipt && !isRefund ? (
            <>
              <div className="form-section-label wide">Receipt accounting</div>
              <section
                className="advance-accounting-preview fund-receipt-accounting-preview wide"
                aria-label="Receipt accounting treatment"
              >
                <div>
                  <span>Debit account</span>
                  <strong>{ledgerAccountName(effectiveLedgerCode)}</strong>
                </div>
                <div>
                  <span>Credit account</span>
                  <strong>{receiptCategory === "Other receipt" ? "3002 · Other Receipts" : "3001 · Fund Received"}</strong>
                </div>
                <div>
                  <span>Budget impact</span>
                  <strong>Nu. 0 · No budget activity</strong>
                </div>
                <div>
                  <span>{isCashLedger ? "Cash" : "Bank"} impact on approval</span>
                  <strong>+ {money.format(Math.max(Number(amount) || 0, 0))}</strong>
                </div>
              </section>
            </>
          ) : (
            <>
              {(isRefund || isDirectTransaction) && (
                <>
                  <div className="form-section-label wide">{isRefund ? "Refund accounting" : "Direct transaction accounting"}</div>
                  <section
                    className="advance-accounting-preview wide"
                    aria-label={isRefund ? "Refund accounting treatment" : "Direct transaction accounting treatment"}
                  >
                    <div>
                      <span>Debit account</span>
                      <strong>{isRefund ? ledgerAccountName(effectiveLedgerCode) : "Budget activities below"}</strong>
                    </div>
                    <div>
                      <span>Credit account</span>
                      <strong>{isRefund ? "Budget activities below" : DIRECT_TRANSACTION_ACCOUNT}</strong>
                    </div>
                    <div>
                      <span>Budget impact on approval</span>
                      <strong>
                        {isRefund ? "+ " : "− "}
                        {money.format(allocatedAmountNu)} available
                      </strong>
                    </div>
                    <div>
                      <span>{isCashLedger ? "Cash" : "Bank"} impact on approval</span>
                      <strong>{isRefund ? `+ ${money.format(allocatedAmountNu)}` : "Nu. 0 · Not affected"}</strong>
                    </div>
                  </section>
                </>
              )}
              <div className="form-section-label wide">
                {isRefund ? "Budget activities refunded" : "Budget activity allocations"}
              </div>
              <section className="voucher-budget-lines wide" aria-label="Voucher budget activity allocations">
                <header>
                  <div>
                    <strong>{isRefund ? "Credit this refund back" : "Allocate this voucher"}</strong>
                    <span>
                      {isRefund
                        ? "Select the activities the original expenditure was charged to."
                        : "Select one or more approved activities for the same payee."}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={addBudgetLine}
                    disabled={budgetLines.length >= activities.length}
                    aria-label="Add activity allocation"
                    title="Add activity allocation"
                  >
                    <PlusIcon />
                  </button>
                </header>
                {allocationDetails.map((line, index) => (
                  <div className="voucher-budget-line" key={line.key}>
                    <span className="voucher-budget-line-number">{index + 1}</span>
                    <label>
                      Approved budget activity
                      <ActivitySearchSelect
                        activities={activities}
                        value={line.activityId}
                        disabledIds={
                          new Set(
                            budgetLines.filter((other) => other.key !== line.key).map((other) => other.activityId),
                          )
                        }
                        onChange={(activityId) => updateBudgetLine(line.key, { activityId })}
                      />
                    </label>
                    <label>
                      {isRefund ? "Refunded amount (Nu.)" : "Allocated amount (Nu.)"}
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        max={isRefund ? line.refundableNu : line.availableNu}
                        value={line.amount}
                        onChange={(event) => updateBudgetLine(line.key, { amount: event.target.value })}
                        placeholder="0"
                        required
                      />
                    </label>
                    <div className="voucher-budget-line-balance">
                      <span>{isRefund ? "Spent to date" : "Available"}</span>
                      <strong>{money.format(isRefund ? line.refundableNu : line.availableNu)}</strong>
                      <small>
                        {line.activity ? `Programme (recommended): ${line.activity.category}` : "Select an activity"}
                      </small>
                    </div>
                    <button
                      className="voucher-budget-line-remove"
                      type="button"
                      onClick={() => removeBudgetLine(line.key)}
                      disabled={budgetLines.length === 1}
                      aria-label={`Remove budget allocation ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <footer>
                  <span>{isRefund ? "Total refund received" : "Total voucher amount"}</span>
                  <strong>{money.format(allocatedAmountNu)}</strong>
                </footer>
              </section>
            </>
          )}

          <div className="form-section-label wide">
            {isReceipt ? "Receipt particulars" : isDirectTransaction ? "Transaction particulars" : "Payment particulars"}
          </div>
          <label className="wide">
            {isReceipt ? "Received from" : isAdvance ? "Advance recipient" : isDirectTransaction ? "Beneficiary / party" : "Paid to"}
            <input
              maxLength={160}
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
              placeholder={
                isRefund
                  ? "Enter who refunded the money"
                  : isReceipt
                    ? "Enter funding agency, person or organisation"
                    : isAdvance
                      ? "Enter the person or organisation receiving the advance"
                      : isDirectTransaction
                        ? "Enter who the bank paid or charged"
                        : "Enter payee name"
              }
              required
            />
          </label>
          {!isReceipt && (
            <>
              <label>
                Payee bank <small>Optional</small>
                <select value={payeeBankName} onChange={(event) => setPayeeBankName(event.target.value)}>
                  <option value="">Select a bank…</option>
                  {BANKS.map((bank) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Payee account number <small>Optional</small>
                <input
                  maxLength={30}
                  value={payeeAccountNumber}
                  onChange={(event) => setPayeeAccountNumber(event.target.value)}
                  placeholder="e.g. 200123456789"
                />
              </label>
            </>
          )}
          <label>
            {isReceipt ? "Fund advice / receipt number" : isDirectTransaction ? "Bank advice / statement reference" : "GRN / Bill number"}{" "}
            <small>Optional</small>
            <input
              maxLength={120}
              value={billReference}
              onChange={(event) => setBillReference(event.target.value)}
              placeholder={
                isReceipt
                  ? "Enter receipt or funding reference"
                  : isDirectTransaction
                    ? "Enter the bank's debit advice reference"
                    : "Supporting document reference"
              }
            />
          </label>
          {hasNoBudgetImpact ? (
            <label>
              {isReceipt ? "Amount received (Nu.)" : "Amount (Nu.)"}
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError("");
                }}
                placeholder="0"
                required
              />
            </label>
          ) : (
            <label>
              {isPayment ? "Gross amount (Nu.)" : isRefund ? "Refund amount (Nu.)" : "Total amount (Nu.)"}
              <input
                type="number"
                value={allocatedAmountNu || ""}
                placeholder="Calculated from allocations"
                readOnly
                aria-readonly="true"
              />
            </label>
          )}
          <label className="wide">
            Particulars
            <textarea
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                isRefund
                  ? "What was refunded and against which original voucher"
                  : isReceipt
                    ? "Purpose or reference for the money received"
                    : isDirectTransaction
                      ? "What the bank paid or charged directly"
                      : isAdvance
                        ? "Purpose and terms of the advance"
                        : "Purpose of payment"
              }
              required
            />
          </label>

          {isPayment && (
            <>
              <div className="form-section-label wide">Payment deductions</div>
              <label>
                GST included in gross (Nu.)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={gstNu}
                  onChange={(event) => {
                    setGstNu(event.target.value);
                    setError("");
                  }}
                />
              </label>
              <label>
                TDS rate
                <select
                  value={tdsRate}
                  onChange={(event) => {
                    setTdsRate(event.target.value);
                    setError("");
                  }}
                >
                  <option value="0">No TDS</option>
                  <option value="2">2% TDS</option>
                  <option value="5">5% TDS</option>
                </select>
              </label>
              {requiresTpn && (
                <label>
                  Payee TPN <small>Required for 2% and 5% TDS</small>
                  <select
                    value={normalizedTpn}
                    onChange={(event) => {
                      setTpn(event.target.value);
                      setError("");
                    }}
                    disabled={!registeredTpns.length}
                    required
                  >
                    <option value="" disabled>
                      {registeredTpns.length ? "Select a registered TPN…" : "No TPN registered yet"}
                    </option>
                    {registeredTpns.map((registration) => (
                      <option key={registration.id} value={registration.tpn}>
                        {registration.tpn} — {registration.name}
                      </option>
                    ))}
                  </select>
                  {!registeredTpns.length && (
                    <small className="voucher-tpn-hint">
                      Register the payee under Accounts → TPN Registration to enable TDS.
                    </small>
                  )}
                </label>
              )}
              <label>
                Advance to recover
                <select
                  value={advanceRecoveryVoucherId}
                  onChange={(event) => {
                    setAdvanceRecoveryVoucherId(event.target.value);
                    setAdvanceRecoveryNu("0");
                    setError("");
                  }}
                >
                  <option value="">No advance recovery</option>
                  {outstandingAdvances.map(({ voucher, outstandingNu }) => (
                    <option key={voucher.id} value={voucher.id}>
                      {voucher.voucherNumber} · {voucher.payee} — {money.format(outstandingNu)} outstanding
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Advance recovery (Nu.)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={selectedOutstandingAdvance?.outstandingNu}
                  value={advanceRecoveryNu}
                  disabled={!advanceRecoveryVoucherId}
                  onChange={(event) => {
                    setAdvanceRecoveryNu(event.target.value);
                    setError("");
                  }}
                />
              </label>
              <section className="voucher-deduction-preview wide" aria-label="Payment deduction calculation">
                <div>
                  <span>Gross amount</span>
                  <strong>{money.format(grossAmountNu)}</strong>
                </div>
                <div>
                  <span>Less: GST for TDS basis</span>
                  <strong>{money.format(gstAmountNu)}</strong>
                </div>
                <div>
                  <span>TDS basis</span>
                  <strong>{money.format(taxableBaseNu)}</strong>
                </div>
                <div>
                  <span>{tdsRate}% TDS</span>
                  <strong>− {money.format(tdsAmountNu)}</strong>
                </div>
                <div>
                  <span>Advance recovery</span>
                  <strong>− {money.format(recoveryAmountNu)}</strong>
                </div>
                <div>
                  <span>Net payment</span>
                  <strong>{money.format(Math.max(netPaymentNu, 0))}</strong>
                </div>
              </section>
              <p className="voucher-formula-note wide">
                TDS = ({money.format(grossAmountNu)} gross − {money.format(gstAmountNu)} GST) × {tdsRate}%. Net payment =
                gross amount − TDS − advance recovery.
              </p>
            </>
          )}

          <div className="form-section-label wide">{isCashLedger ? "Cash in hand check" : "Bank balance check"}</div>
          <section className="voucher-bank-preview wide" aria-label={`Projected ${balanceName} after voucher approval`}>
            <div>
              <span>Current {balanceName}</span>
              <strong>{money.format(currentBalanceNu)}</strong>
            </div>
            <div>
              <span>This voucher on approval</span>
              <strong>
                {currentVoucherEffectNu > 0 ? "+ " : currentVoucherEffectNu < 0 ? "− " : ""}
                {money.format(Math.abs(currentVoucherEffectNu))}
              </strong>
            </div>
            <div>
              <span>Projected {balanceName}</span>
              <strong>{money.format(projectedBalanceNu)}</strong>
            </div>
          </section>
          <p className="voucher-formula-note wide">
            {isRefund
              ? `The refund increases the ${balanceName} and credits the selected budget activities back, only after approval.`
              : isReceipt
                ? `The receipt increases the ${balanceName} only after approval. It has no impact on any approved budget activity.`
                : isDirectTransaction
                  ? "A direct transaction is charged to the budget on approval, but the bank already moved the money, so the system bank balance is not changed."
                  : "Payments reduce it by the net amount, advances reduce it by the gross amount, and journals have no bank effect."}
          </p>
        </div>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving
              ? "Saving…"
              : isReceipt
                ? "Submit receipt for approval"
                : isDirectTransaction
                  ? "Submit direct transaction for approval"
                  : "Submit for approval"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Searchable approved-activity picker                                        */
/* -------------------------------------------------------------------------- */

function ActivitySearchSelect({
  activities,
  value,
  disabledIds,
  onChange,
}: {
  activities: Activity[];
  value: number;
  disabledIds: Set<number>;
  onChange: (activityId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();

  const labelFor = (activity: Activity) => `${activity.obc} · ${activity.activity} (${activity.category})`;
  const selected = activities.find((activity) => activity.id === value);
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? activities.filter((activity) => labelFor(activity).toLocaleLowerCase().includes(needle))
    : activities;

  const choose = (activity: Activity) => {
    onChange(activity.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      className="activity-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="activity-search-input"
        placeholder="Search OBC, activity or programme…"
        value={open ? query : selected ? labelFor(selected) : ""}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <ul className="activity-search-options" role="listbox" id={listId}>
          {matches.length ? (
            matches.map((activity) => {
              const isSelected = activity.id === value;
              const isDisabled = disabledIds.has(activity.id) && !isSelected;
              return (
                <li key={activity.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={isSelected ? "is-selected" : ""}
                    disabled={isDisabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => !isDisabled && choose(activity)}
                  >
                    <strong>{activity.obc}</strong>
                    <span>
                      {activity.activity} <em>({activity.category})</em>
                      {isDisabled && " · already allocated"}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="activity-search-empty">No approved activity matches “{query}”.</li>
          )}
        </ul>
      )}
    </div>
  );
}
