import { useRouter } from "expo-router";
import { useEffect } from "react";
import { create } from "zustand";

/**
 * "Take a quick tour" on the last onboarding screen has to finish onboarding
 * FIRST: the root layout only registers the tour route once onboarding is
 * complete, so navigating to it in the same tick would hit a route that does
 * not exist yet (a blank screen on web). The button therefore leaves a note
 * here and completes onboarding; `useLaunchPendingTour`, mounted at the root,
 * opens the tour as soon as the main stack is in place. Memory only: a note
 * that survived an app restart would open a tour nobody asked for.
 */
interface TourLaunchState {
  pending: boolean;
  request: () => void;
  clear: () => void;
}

export const useTourLaunchStore = create<TourLaunchState>()((set) => ({
  pending: false,
  request: () => set({ pending: true }),
  clear: () => set({ pending: false }),
}));

/** Opens the tour once, when it was asked for and the main stack is active. */
export function useLaunchPendingTour(mainStackActive: boolean): void {
  const router = useRouter();
  const pending = useTourLaunchStore((state) => state.pending);
  const clear = useTourLaunchStore((state) => state.clear);

  useEffect(() => {
    if (!pending || !mainStackActive) {
      return;
    }
    clear();
    router.push("/tour");
  }, [pending, mainStackActive, clear, router]);
}
