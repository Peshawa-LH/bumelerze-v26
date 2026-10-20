import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter, type Href } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { isOnboardingPath, resolveIncomingLink } from "./incoming";

/**
 * A link that opens the app before onboarding is finished is kept and opened
 * right after it.
 *
 * Until onboarding is done, the root layout only knows the onboarding screens
 * (`Stack.Protected` in app/_layout.tsx), so the screen a shared link points
 * at does not exist yet: the event, profile or family-join link was lost, and
 * on the web the short event link (`/e/<id>`, outside the gate) even stayed a
 * blank page. Now:
 * 1. Every link that opens the app is noted: on iOS/Android by
 *    app/+native-intent.tsx, on the web from the address the page was loaded
 *    with (below).
 * 2. Once the settings are read (`usePendingLink`): with onboarding done,
 *    Expo Router has already opened it and the note is dropped; otherwise it
 *    is kept on the device, so a restart in the middle of onboarding (the
 *    reading-direction switch reloads the app) does not lose it, and a
 *    screen outside the onboarding (the web's blank `/e/<id>`) gives way to
 *    the onboarding.
 * 3. When onboarding completes, the link opens on top of Home, so Back
 *    leads Home. It is opened once, and only within a day.
 */

/** A kept link older than this is dropped instead of opened. */
export const PENDING_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface ArrivedLinkState {
  /** The latest link that opened the app, not looked at yet. */
  arrived: string | null;
  setArrived: (path: string | null) => void;
}

/** Memory only: a link is looked at within moments of arriving. Kept apart
 * from the stored link below, whose every change is written to the device. */
export const useArrivedLinkStore = create<ArrivedLinkState>()((set) => ({
  arrived: null,
  setArrived: (arrived) => set({ arrived }),
}));

interface PendingLinkState {
  /** A link that arrived before onboarding was done. */
  pending: string | null;
  /** When it was kept (UTC ms). */
  savedAt: number | null;
  /** True once the stored link has been read back from the device. */
  hasHydrated: boolean;
  keep: (path: string, now: number) => void;
  clear: () => void;
}

export const usePendingLinkStore = create<PendingLinkState>()(
  persist(
    (set) => ({
      pending: null,
      savedAt: null,
      hasHydrated: false,
      keep: (path, now) => set({ pending: path, savedAt: now }),
      clear: () => set({ pending: null, savedAt: null }),
    }),
    {
      name: "bumelerze.pending-link",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pending: state.pending, savedAt: state.savedAt }),
      // Nothing saved (first launch) or storage unreadable still counts as
      // read, or a link would wait forever. (Reading is always asynchronous
      // here, so the store exists by the time this runs.)
      onRehydrateStorage: () => () => {
        usePendingLinkStore.setState({ hasHydrated: true });
      },
    },
  ),
);

/**
 * Notes a link that opened the app. The start screen ("/") and the
 * onboarding screens are not worth keeping.
 */
export function noteIncomingLink(path: string): void {
  if (path === "/" || path.startsWith("/?") || isOnboardingPath(path)) {
    return;
  }
  useArrivedLinkStore.getState().setArrived(path);
}

/**
 * Web: the address the page was loaded with, inside the app (without the
 * base path a subpath build is served under). Null off the web.
 */
export function webEntryPath(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.location) {
    return null;
  }
  const { pathname, search } = window.location;
  const base = process.env.EXPO_BASE_URL ?? "";
  const inner =
    base && (pathname === base || pathname.startsWith(`${base}/`))
      ? pathname.slice(base.length) || "/"
      : pathname;
  return `${inner}${search}`;
}

/** Web: notes the address the page was opened with. Runs once, when the root
 * layout loads, before Expo Router could replace the address. */
export function noteWebEntryLink(): void {
  const entry = webEntryPath();
  if (entry === null) {
    return;
  }
  const link = resolveIncomingLink(entry);
  if (link.kind === "route") {
    noteIncomingLink(link.path);
  }
}
noteWebEntryLink();

export interface PendingLinkOptions {
  /** True once the root stack is on screen for good: settings and language
   * read and applied, no restart under way. */
  ready: boolean;
  onboardingCompleted: boolean;
}

/** Mounted once, in the root layout (app/_layout.tsx). */
export function usePendingLink({ ready, onboardingCompleted }: PendingLinkOptions): void {
  const router = useRouter();
  const pathname = usePathname();
  const arrived = useArrivedLinkStore((state) => state.arrived);
  const hydrated = usePendingLinkStore((state) => state.hasHydrated);
  const pending = usePendingLinkStore((state) => state.pending);

  // A link arrived: Expo Router already opened it when onboarding is done;
  // otherwise keep it, and leave any screen outside the onboarding.
  useEffect(() => {
    if (!ready || !hydrated || arrived === null) {
      return;
    }
    useArrivedLinkStore.getState().setArrived(null);
    if (onboardingCompleted) {
      return;
    }
    usePendingLinkStore.getState().keep(arrived, Date.now());
    if (!isOnboardingPath(pathname)) {
      router.replace("/onboarding");
    }
  }, [ready, hydrated, arrived, onboardingCompleted, pathname, router]);

  // Onboarding is done: open the kept link once.
  useEffect(() => {
    if (!ready || !hydrated || !onboardingCompleted || pending === null) {
      return;
    }
    const { savedAt, clear } = usePendingLinkStore.getState();
    clear();
    if (savedAt !== null && Date.now() - savedAt <= PENDING_LINK_MAX_AGE_MS) {
      router.push(pending as Href);
    }
  }, [ready, hydrated, onboardingCompleted, pending, router]);
}
