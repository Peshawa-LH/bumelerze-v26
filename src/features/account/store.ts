import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";

import { getSupabaseClient } from "@/lib/supabase";
import { loadProfile } from "./service";
import type { AccountState } from "./types";

/**
 * Client-side mirror of the Supabase auth session + the signed-in user's
 * profile rows. One store, one auth subscription for the whole app
 * (`ensureAccountSync`), so every screen reads the same state.
 */

const INITIAL_STATE: AccountState = {
  status: "loading",
  userId: null,
  email: null,
  profile: null,
  privateProfile: null,
  profileLoaded: false,
};

export const useAccountStore = create<AccountState>(() => INITIAL_STATE);

let started = false;
let unsubscribe: (() => void) | null = null;

/** Re-reads the profile rows of the signed-in account into the store. */
export async function refreshProfile(): Promise<void> {
  const { status, userId } = useAccountStore.getState();
  if (status !== "account" || !userId) {
    return;
  }
  try {
    const { profile, privateProfile } = await loadProfile(userId);
    // The user may have signed out / switched while the request ran.
    if (useAccountStore.getState().userId === userId) {
      useAccountStore.setState({ profile, privateProfile, profileLoaded: true });
    }
  } catch {
    // Offline or transient: keep whatever is cached in memory; the screens
    // treat "not loaded" and "loaded but empty" differently on purpose.
  }
}

function applySession(session: Session | null): void {
  const user = session?.user ?? null;
  if (!user || user.is_anonymous === true) {
    useAccountStore.setState({
      status: "anonymous",
      userId: user?.id ?? null,
      email: null,
      profile: null,
      privateProfile: null,
      profileLoaded: false,
    });
    return;
  }
  const previous = useAccountStore.getState();
  const sameUser = previous.status === "account" && previous.userId === user.id;
  useAccountStore.setState({
    status: "account",
    userId: user.id,
    email: user.email ?? null,
    ...(sameUser
      ? {}
      : { profile: null, privateProfile: null, profileLoaded: false }),
  });
  if (!sameUser) {
    // Deferred: supabase-js docs warn against awaiting client calls inside
    // the onAuthStateChange callback itself.
    setTimeout(() => void refreshProfile(), 0);
  }
}

/** Reads the current session right now and loads the profile — used right
 * after sign-in so the next navigation decision sees fresh data instead of
 * waiting for the auth listener. */
export async function syncAccountNow(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }
  const { data } = await client.auth.getSession();
  applySession(data.session);
  await refreshProfile();
}

/** Starts (once) the session listener. Safe to call from every screen. */
export function ensureAccountSync(): void {
  if (started) {
    return;
  }
  const client = getSupabaseClient();
  if (!client) {
    return;
  }
  started = true;
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    applySession(session);
  });
  unsubscribe = () => data.subscription.unsubscribe();
  client.auth
    .getSession()
    .then(({ data: sessionData }) => applySession(sessionData.session))
    .catch(() => applySession(null));
}

/** Test-only: back to the initial state and a stopped listener. */
export function __resetAccountStoreForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  useAccountStore.setState(INITIAL_STATE);
}
