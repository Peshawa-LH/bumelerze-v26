import { useEffect } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { ensureAccountSync, refreshProfile, useAccountStore } from "./store";
import type { AccountState } from "./types";

export interface UseAccountResult extends AccountState {
  refreshProfile: () => Promise<void>;
}

/**
 * Current account state. `account` means a session whose user is not
 * anonymous; `anonymous` is every other install (including one that has not
 * signed in anonymously yet); `unconfigured` means no Supabase project is
 * wired, so account features are hidden.
 */
export function useAccount(): UseAccountResult {
  const state = useAccountStore();

  useEffect(() => {
    ensureAccountSync();
  }, []);

  return {
    ...state,
    status: isSupabaseConfigured() ? state.status : "unconfigured",
    refreshProfile,
  };
}
