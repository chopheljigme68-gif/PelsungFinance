"use client";

import { useState, type FormEvent } from "react";
import { ModalShell, PlusIcon } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api";
import { fiscalYearEndDate, fiscalYearStartDate } from "@/lib/fiscal-year";
import { currentBhutanDate, fiscalYearLabel, money, roundNu } from "@/lib/format";
import { BANKS } from "@/lib/reference";
import { outstandingAdvanceBalance } from "@/lib/totals";
import { calculateVoucherDeductions, TPN_PATTERN, isPostedStatus, voucherBankEffectNu } from "@/lib/vouchers";
import { useApp } from "@/providers/app-provider";
import type { Activity, Voucher } from "@/types";

const defaultTransactionDate = (fiscalYear: string) => {
  const today = currentBhutanDate();
  return today >= fiscalYearStartDate(fiscalYear) && today <= fiscalYearEndDate(fiscalYear)
    ? today
    : fiscalYearStartDate(fiscalYear);
};

type BudgetLineDraft = { key: number; activityId: number; amount: string };

/**
 * Voucher preparation.
 *
 * Payments and journals are allocated across one or more approved activities
 * and the allocation total *is* the voucher amount; advances and fund receipts
 * take a single amount and touch no budget at all. Deductions are previewed
 * with the same arithmetic the server applies.
 */
export function VoucherModal({
  activities,
  vouchers,
  bankBalanceNu,
  onClose,
}: {
  activities: Activity[];
  vouchers: Voucher[];
  bankBalanceNu: number;
  onClose: () => void;
}) {
  const { fiscalYear, can, run } = useApp();
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
  const [date, setDate] = useState(() => defaultTransactionDate(fiscalYear));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isAdvance = voucherType === "Advance";
  const isFundReceipt = voucherType === "Receipt";
  const isPayment = voucherType === "Payment";
  const hasNoBudgetImpact = isAdvance || isFundReceipt;

  const allocationDetails = budgetLines.map((line) => {
    const activity = activities.find((item) => item.id === line.activityId);
    return {
      ...line,
      activity,
      amountNu: Math.max(roundNu(Number(line.amount) || 0), 0),
      availableNu: activity ? activity.approvedNu - activity.committedNu : 0,
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
  const validTpn = !requiresTpn || (normalizedTpn.length <= 30 && TPN_PATTERN.test(normalizedTpn));

  const currentVoucherBankEffectNu = voucherBankEffectNu({
    voucherType,
    amountNu: grossAmountNu,
    netPaymentNu: Math.max(netPaymentNu, 0),
  });
  const projectedBankBalanceNu = bankBalanceNu + currentVoucherBankEffectNu;

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
      setError("Select an approved budget activity and enter a positive amount for every allocation line.");
      return;
    }

    const overBudgetAllocation = allocationDetails.find((line) => line.amountNu > line.availableNu);
    if (!hasNoBudgetImpact && overBudgetAllocation) {
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
      setError("Enter the payee's TPN before submitting a voucher with 2% or 5% TDS.");
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
        }),
      isFundReceipt
        ? "Fund receipt submitted for approval. It will increase the bank balance only after approval and will not affect the budget."
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
            <h2>{isFundReceipt ? "Record Fund Receipt" : "Prepare voucher"}</h2>
            <p>
              {isFundReceipt
                ? "Record funds deposited into the Pelsung operating bank account by HMS or another funding agency."
                : "Enter the same particulars that will appear on the approved printable voucher."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="voucher-system-strip" aria-label="Voucher system details">
          <div>
            <span>Bank Account No.</span>
            <strong>110116024748</strong>
          </div>
          <div className="voucher-current-bank-balance">
            <span>Current Bank Balance</span>
            <strong>{money.format(bankBalanceNu)}</strong>
          </div>
          <div>
            <span>Payment Mode</span>
            <strong>Bank</strong>
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
                setError("");
              }}
            >
              {canPrepareVoucher && <option value="Payment">Payment</option>}
              {canPrepareVoucher && <option value="Journal">Journal</option>}
              {canRecordFundReceipt && <option value="Receipt">Fund Receipt</option>}
              {canPrepareVoucher && <option value="Advance">Advance</option>}
            </select>
          </label>
          <label>
            Transaction date
            <input
              type="date"
              min={fiscalYearStartDate(fiscalYear)}
              max={fiscalYearEndDate(fiscalYear)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>

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
          ) : isFundReceipt ? (
            <>
              <div className="form-section-label wide">Fund receipt accounting</div>
              <section
                className="advance-accounting-preview fund-receipt-accounting-preview wide"
                aria-label="Fund receipt accounting treatment"
              >
                <div>
                  <span>Debit account</span>
                  <strong>1001 · Bank</strong>
                </div>
                <div>
                  <span>Credit account</span>
                  <strong>3001 · Fund Received</strong>
                </div>
                <div>
                  <span>Budget impact</span>
                  <strong>Nu. 0 · No budget activity</strong>
                </div>
                <div>
                  <span>Bank impact on approval</span>
                  <strong>+ {money.format(Math.max(Number(amount) || 0, 0))}</strong>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="form-section-label wide">Budget activity allocations</div>
              <section className="voucher-budget-lines wide" aria-label="Voucher budget activity allocations">
                <header>
                  <div>
                    <strong>Allocate this voucher</strong>
                    <span>Select one or more approved activities for the same payee.</span>
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
                      <select
                        value={line.activityId}
                        onChange={(event) => updateBudgetLine(line.key, { activityId: Number(event.target.value) })}
                        required
                      >
                        {activities.map((item) => (
                          <option
                            key={item.id}
                            value={item.id}
                            disabled={budgetLines.some((other) => other.key !== line.key && other.activityId === item.id)}
                          >
                            {item.obc} · {item.activity} ({item.category})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Allocated amount (Nu.)
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        max={line.availableNu}
                        value={line.amount}
                        onChange={(event) => updateBudgetLine(line.key, { amount: event.target.value })}
                        placeholder="0"
                        required
                      />
                    </label>
                    <div className="voucher-budget-line-balance">
                      <span>Available</span>
                      <strong>{money.format(line.availableNu)}</strong>
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
                  <span>Total voucher amount</span>
                  <strong>{money.format(allocatedAmountNu)}</strong>
                </footer>
              </section>
            </>
          )}

          <div className="form-section-label wide">{isFundReceipt ? "Fund receipt particulars" : "Payment particulars"}</div>
          <label className="wide">
            {isFundReceipt ? "Received from" : isAdvance ? "Advance recipient" : "Paid to"}
            <input
              maxLength={160}
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
              placeholder={
                isFundReceipt
                  ? "Enter funding agency name"
                  : isAdvance
                    ? "Enter the person or organisation receiving the advance"
                    : "Enter payee name"
              }
              required
            />
          </label>
          {!isFundReceipt && (
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
            {isFundReceipt ? "Fund advice / receipt number" : "GRN / Bill number"} <small>Optional</small>
            <input
              maxLength={120}
              value={billReference}
              onChange={(event) => setBillReference(event.target.value)}
              placeholder={isFundReceipt ? "Enter funding reference" : "Supporting document reference"}
            />
          </label>
          {hasNoBudgetImpact ? (
            <label>
              {isFundReceipt ? "Fund received (Nu.)" : "Amount (Nu.)"}
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
              {isPayment ? "Gross amount (Nu.)" : "Total amount (Nu.)"}
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
                isFundReceipt
                  ? "Purpose or reference for the fund received"
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
                  <input
                    maxLength={30}
                    value={tpn}
                    onChange={(event) => {
                      setTpn(event.target.value.toLocaleUpperCase().replace(/[^A-Z0-9./-]/g, "").slice(0, 30));
                      setError("");
                    }}
                    placeholder="Enter taxpayer number"
                    required
                  />
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

          <div className="form-section-label wide">Bank balance check</div>
          <section className="voucher-bank-preview wide" aria-label="Projected bank balance after voucher approval">
            <div>
              <span>Current bank balance</span>
              <strong>{money.format(bankBalanceNu)}</strong>
            </div>
            <div>
              <span>This voucher on approval</span>
              <strong>
                {currentVoucherBankEffectNu > 0 ? "+ " : currentVoucherBankEffectNu < 0 ? "− " : ""}
                {money.format(Math.abs(currentVoucherBankEffectNu))}
              </strong>
            </div>
            <div>
              <span>Projected bank balance</span>
              <strong>{money.format(projectedBankBalanceNu)}</strong>
            </div>
          </section>
          <p className="voucher-formula-note wide">
            {isFundReceipt
              ? "The fund receipt increases the bank balance only after approval. It has no impact on any approved budget activity."
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
            {saving ? "Saving…" : isFundReceipt ? "Submit fund receipt for approval" : "Submit for approval"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}