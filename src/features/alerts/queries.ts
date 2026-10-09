import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { isSupabaseConfigured } from "@/lib/supabase";

import { SupabaseAlertsTransport, type AlertsTransport } from "./transport";
import { NO_ALERT_ACCESS, type AlertAccess, type AlertMode, type AlertsOverview } from "./types";

export const alertsKeys = {
  all: ["alerts"] as const,
  access: (userId: string) => ["alerts", "access", userId] as const,
  overview: ["alerts", "overview"] as const,
};

export interface UseAlertAccess extends AlertAccess {
  isLoading: boolean;
}

/**
 * Who may see the real alert settings (alerts_my_access, migration 0062).
 * Anything short of a clear "yes" (no session, offline, the migration not
 * applied yet, still loading) reads as "coming soon": the safe default.
 * Never cached on the device.
 */
export function useAlertAccess(transport: AlertsTransport = SupabaseAlertsTransport): UseAlertAccess {
  const account = useAccount();
  const userId = account.userId;
  const enabled = isSupabaseConfigured() && userId !== null;
  const query = useQuery({
    queryKey: alertsKeys.access(userId ?? "none"),
    queryFn: () => transport.fetchAccess(),
    enabled,
    staleTime: 60_000,
    retry: 1,
    meta: { persist: false },
  });
  const data = query.data ?? NO_ALERT_ACCESS;
  return { ...data, isLoading: enabled && query.isLoading };
}

/** Admin > Alerts (admin_alerts_overview, alerts.test). */
export function useAlertsOverview(
  allowed: boolean,
  transport: AlertsTransport = SupabaseAlertsTransport,
) {
  return useQuery<AlertsOverview>({
    queryKey: alertsKeys.overview,
    queryFn: () => transport.fetchOverview(),
    enabled: allowed && isSupabaseConfigured(),
    staleTime: 15_000,
    meta: { persist: false },
  });
}

export function useAlertsAdminActions(transport: AlertsTransport = SupabaseAlertsTransport) {
  const queryClient = useQueryClient();
  const store = (overview: AlertsOverview) => {
    queryClient.setQueryData(alertsKeys.overview, overview);
    void queryClient.invalidateQueries({ queryKey: ["alerts", "access"] });
  };
  const setMode = useMutation({
    mutationFn: (mode: AlertMode) => transport.setMode(mode),
    onSuccess: store,
  });
  const addTester = useMutation({
    mutationFn: (username: string) => transport.addTester(username),
    onSuccess: store,
  });
  const removeTester = useMutation({
    mutationFn: (userId: string) => transport.removeTester(userId),
    onSuccess: store,
  });
  return {
    setMode: (mode: AlertMode) => setMode.mutateAsync(mode),
    addTester: (username: string) => addTester.mutateAsync(username),
    removeTester: (userId: string) => removeTester.mutateAsync(userId),
  };
}
