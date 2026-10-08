import { create } from "zustand";

interface TabBarState {
  /** True while the bottom tab bar is slid out of view by scrolling down. */
  hidden: boolean;
  /**
   * True while the bar takes its strip of the page. Hiding gives the strip to
   * the content at once; it is taken back only when the bar has finished
   * sliding in (`settle`), so it never covers content mid-slide.
   */
  inLayout: boolean;
  setHidden: (hidden: boolean) => void;
  /** The bar has finished sliding back in. */
  settle: () => void;
}

/**
 * Whether the scroll-aware tab bar is currently hidden. One value for the
 * whole app: only the focused screen scrolls, and every navigation change
 * shows the bar again (`ScrollAwareTabBar`). Kept out of React state so the
 * snackbar, which lives above the navigator, can follow the bar.
 */
export const useTabBarStore = create<TabBarState>((set) => ({
  hidden: false,
  inLayout: true,
  setHidden: (hidden) =>
    set((state) => {
      if (state.hidden === hidden) return state;
      return hidden ? { hidden: true, inLayout: false } : { hidden: false };
    }),
  settle: () =>
    set((state) => (state.hidden || state.inLayout ? state : { inLayout: true })),
}));
