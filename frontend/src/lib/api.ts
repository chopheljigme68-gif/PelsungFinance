import type { AccountingData, AppUser, PasswordPolicy } from "@/types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/**
 * An error the API reported deliberately.
 *
 * `details` carries the extra fields the server sends with conflicts —
 * `availableBalanceNu`, `expenditureAmountNu`, `outstandingAdvanceNu` — which
 * the budget screens show alongside the message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  get availableBalanceNu(): number | null {
    return typeof this.details.availableBalanceNu === "number" ? this.details.availableBalanceNu : null;
  }

  get expenditureAmountNu(): number | null {
    return typeof this.details.expenditureAmountNu === "number" ? this.details.expenditureAmountNu : null;
  }

  get outstandingAdvanceNu(): number | null {
    return typeof this.details.outstandingAdvanceNu === "number" ? this.details.outstandingAdvanceNu : null;
  }

  /** True when the signed-in user must replace a temporary password first. */
  get requiresPasswordChange(): boolean {
    return this.status === 428;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      // The session is an httpOnly cookie, so every call must include credentials.
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "The Pelsung Finance service could not be reached. Check your connection and try again.");
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const { error, ...details } = payload;
    throw new ApiError(response.status, typeof error === "string" ? error : "The requested action failed.", details);
  }

  return payload as T;
}

export type SessionResponse = { user: AppUser; policy: PasswordPolicy };

export const api = {
  /* Session ---------------------------------------------------------------- */
  session: () => request<SessionResponse>("/api/auth/session"),
  login: (username: string, password: string) =>
    request<SessionResponse>("/api/auth/login", { method: "POST", body: { username, password } }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request<SessionResponse>("/api/auth/password", { method: "POST", body }),

  /* Read model ------------------------------------------------------------- */
  accounting: async (fiscalYear: string, signal?: AbortSignal) => {
    const data = await request<AccountingData>(`/api/accounting?fiscalYear=${encodeURIComponent(fiscalYear)}`, {
      signal,
    });
    // Guarantee the optional account sections are always arrays, so a backend
    // deployed before its migration (or an older backend) can never crash a
    // screen that reads them.
    return {
      ...data,
      bankReconciliations: data.bankReconciliations ?? [],
      bankReconciliationItems: data.bankReconciliationItems ?? [],
      monthClosures: data.monthClosures ?? [],
    } satisfies AccountingData;
  },

  /* Budget ----------------------------------------------------------------- */
  addBudgetActivity: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/budget/activities", { method: "POST", body }),
  reappropriateBudget: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/budget/reappropriations", { method: "POST", body }),
  addSupplementaryBudget: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/budget/supplementary", { method: "POST", body }),

  /* Vouchers --------------------------------------------------------------- */
  createVoucher: (body: Record<string, unknown>) => request<AccountingData>("/api/vouchers", { method: "POST", body }),
  submitVoucher: (voucherId: number, fiscalYear: string) =>
    request<AccountingData>(`/api/vouchers/${voucherId}/submit`, { method: "POST", body: { fiscalYear } }),
  decideVoucher: (voucherId: number, status: "Approved" | "Rejected", fiscalYear: string) =>
    request<AccountingData>(`/api/vouchers/${voucherId}/status`, { method: "PATCH", body: { status, fiscalYear } }),
  reverseVoucher: (voucherId: number, reversalReason: string, fiscalYear: string) =>
    request<AccountingData>(`/api/vouchers/${voucherId}/reverse`, {
      method: "POST",
      body: { reversalReason, fiscalYear },
    }),

  /* Payroll ---------------------------------------------------------------- */
  addDepartment: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/payroll/departments", { method: "POST", body }),
  updateDepartment: (departmentId: number, body: Record<string, unknown>) =>
    request<AccountingData>(`/api/payroll/departments/${departmentId}`, { method: "PATCH", body }),
  addEmployee: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/payroll/employees", { method: "POST", body }),
  updateEmployee: (employeeId: number, body: Record<string, unknown>) =>
    request<AccountingData>(`/api/payroll/employees/${employeeId}`, { method: "PUT", body }),
  setEmployeeStatus: (employeeId: number, status: "Active" | "Inactive", fiscalYear: string) =>
    request<AccountingData>(`/api/payroll/employees/${employeeId}/status`, {
      method: "PATCH",
      body: { status, fiscalYear },
    }),
  updateEmployeeIdentity: (employeeId: number, body: Record<string, unknown>) =>
    request<AccountingData>(`/api/payroll/employees/${employeeId}/identity`, { method: "PATCH", body }),
  finalizePayBill: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/payroll/pay-bills/finalize", { method: "POST", body }),
  postPayBill: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/payroll/pay-bills/post", { method: "POST", body }),
  undoPayBillPosting: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/payroll/pay-bills/undo-posting", { method: "POST", body }),
  unfinalizePayBill: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/payroll/pay-bills/unfinalize", { method: "POST", body }),

  /* Remittances ------------------------------------------------------------ */
  finalizePayrollRemittance: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/remittance/payroll/finalize", { method: "POST", body }),
  postPayrollRemittance: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/remittance/payroll/post", { method: "POST", body }),
  finalizeSupplierTdsRemittance: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/remittance/supplier-tds/finalize", { method: "POST", body }),

  /* Bank reconciliation & month close -------------------------------------- */
  saveBankReconciliation: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/reconciliation/bank", { method: "POST", body }),
  closeMonth: (body: Record<string, unknown>) =>
    request<AccountingData>("/api/reconciliation/month-close", { method: "POST", body }),

  /* Users ------------------------------------------------------------------ */
  createUser: (body: Record<string, unknown>) => request<AccountingData>("/api/users", { method: "POST", body }),
  updateUser: (userId: number, body: Record<string, unknown>) =>
    request<AccountingData>(`/api/users/${userId}`, { method: "PUT", body }),
  updateUserRole: (userId: number, role: string, fiscalYear: string) =>
    request<AccountingData>(`/api/users/${userId}/role`, { method: "PATCH", body: { role, fiscalYear } }),
  resendInvitation: (userId: number, fiscalYear: string) =>
    request<AccountingData>(`/api/users/${userId}/invitation`, { method: "POST", body: { fiscalYear } }),
  deleteUser: (userId: number) => request<AccountingData>(`/api/users/${userId}`, { method: "DELETE" }),
};

export { API_URL };