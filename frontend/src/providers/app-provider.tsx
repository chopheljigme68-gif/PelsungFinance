"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import { DEFAULT_FISCAL_YEAR, normalizeFiscalYear } from "@/lib/fiscal-year";
import { fiscalYearLabel } from "@/lib/format";
import type { AccountingData, AppUser, Permission } from "@/types";

const FISCAL_YEAR_STORAGE_KEY = "pelsung.fiscalYear";

function readStoredFiscalYear(): string {
  if (typeof window === "undefined") return DEFAULT_FISCAL_YEAR;
  try {
    return normalizeFiscalYear(window.localStorage.getItem(FISCAL_YEAR_STORAGE_KEY));
  } catch {
    return DEFAULT_FISCAL_YEAR;
  }
}

function storeFiscalYear(fiscalYear: string): void {
  try {
    window.localStorage.setItem(FISCAL_YEAR_STORAGE_KEY, fiscalYear);
  } catch {
    // A private window with storage disabled is not a reason to fail.
  }
}

type AppContextValue = {
  user: AppUser | null;
  data: AccountingData | null;
  fiscalYear: string;
  loading: boolean;
  busy: boolean;
  notice: string;
  passwordModalOpen: boolean;
  setNotice: (notice: string) => void;
  clearNotice: () => void;
  setPasswordModalOpen: (open: boolean) => void;
  changeFiscalYear: (fiscalYear: string) => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Runs a mutation, stores the refreshed snapshot it returns and shows a
   * notice. Returns true on success and false when the API refused, so callers
   * can keep a modal open on failure.
   */
  run: (
    action: () => Promise<AccountingData>,
    successMessage: string,
    options?: { onSuccess?: (data: AccountingData) => void; onError?: (error: ApiError) => string | void },
  ) => Promise<boolean>;
  can: (permission: Permission) => boolean;
  applyUser: (user: AppUser) => void;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside <AppProvider>");
  return context;
}

/** The loaded snapshot; screens rendered inside the workspace always have one. */
export function useAccounting(): AccountingData {
  const { data } = useApp();
  if (!data) throw new Error("useAccounting must be used inside a loaded workspace route");
  return data;
}

function AppState({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [fiscalYear, setFiscalYear] = useState<string>(readStoredFiscalYear);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);

  const query = useQuery({
    queryKey: ["accounting", fiscalYear],
    queryFn: ({ signal }) => api.accounting(fiscalYear, signal),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 401) && failureCount < 2,
    staleTime: 15_000,
  });

  const data = query.data ?? null;
  const currentUser = data?.currentUser ?? user;
  const sessionExpired = query.error instanceof ApiError && query.error.status === 401;

  // A 401 on the snapshot means the session expired or was revoked elsewhere.
  useEffect(() => {
    if (sessionExpired && !window.location.pathname.startsWith("/login")) router.replace("/login");
  }, [router, sessionExpired]);

  const applySnapshot = useCallback(
    (snapshot: AccountingData) => {
      queryClient.setQueryData(["accounting", snapshot.fiscalYear ?? fiscalYear], snapshot);
      setUser(snapshot.currentUser);
    },
    [fiscalYear, queryClient],
  );

  const run = useCallback<AppContextValue["run"]>(
    async (action, successMessage, options) => {
      setBusy(true);
      try {
        const snapshot = await action();
        applySnapshot(snapshot);
        setNotice(snapshot.actionNotice ?? successMessage);
        options?.onSuccess?.(snapshot);
        return true;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401) {
            router.replace("/login");
            return false;
          }
          if (error.requiresPasswordChange) {
            setPasswordModalOpen(true);
            setNotice(error.message);
            return false;
          }
          setNotice(options?.onError?.(error) || error.message);
        } else {
          setNotice(error instanceof Error ? error.message : "The requested action failed.");
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, router],
  );

  const changeFiscalYear = useCallback(
    async (nextFiscalYear: string) => {
      const normalized = normalizeFiscalYear(nextFiscalYear);
      setFiscalYear(normalized);
      storeFiscalYear(normalized);
      setNotice(`Loading ${fiscalYearLabel(normalized)} financial data…`);
      await queryClient.invalidateQueries({ queryKey: ["accounting", normalized] });
      setNotice(
        `${fiscalYearLabel(normalized)} is now active. Dashboard, budgets, vouchers and reports have been updated.`,
      );
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["accounting", fiscalYear] });
  }, [fiscalYear, queryClient]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      queryClient.clear();
      setUser(null);
      router.replace("/login");
    }
  }, [queryClient, router]);

  const value = useMemo<AppContextValue>(
    () => ({
      user: currentUser,
      data,
      fiscalYear: data?.fiscalYear ?? fiscalYear,
      loading: query.isPending || query.isFetching,
      busy,
      notice,
      passwordModalOpen,
      setNotice,
      clearNotice: () => setNotice(""),
      setPasswordModalOpen,
      changeFiscalYear,
      refresh,
      run,
      can: (permission) => Boolean(currentUser?.permissions.includes(permission)),
      applyUser: setUser,
      signOut,
    }),
    [busy, changeFiscalYear, currentUser, data, fiscalYear, notice, passwordModalOpen, query.isFetching, query.isPending, refresh, run, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, gcTime: 5 * 60_000 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppState>{children}</AppState>
    </QueryClientProvider>
  );
}
