import { useEffect, type RefObject } from "react";
import type { View } from "react-native";

/** Movement (px) after which a touch counts as sideways or up-and-down. */
const DECIDE_AFTER = 6;

/**
 * Keeps the page from scrolling while a finger swipes the carousel sideways
 * (iOS/Android: `swipe-lock.ts`, nothing to do).
 *
 * In a browser the page scroll and the carousel compete for the same finger.
 * An iPhone scrolls the page by the vertical part of any swipe, and
 * react-native-web ends the carousel's gesture as soon as the page under it
 * scrolls, so a sideways swipe with a slight arc did nothing. Here each touch
 * is decided once, after a few px: mostly sideways, and the page is held
 * still for the rest of it (the carousel gets it); mostly up or down, and the
 * page scrolls as usual. The listener is not passive, or the browser would
 * ignore `preventDefault`.
 */
/** `active`: the carousel is drawn (its view exists). */
export function useHorizontalSwipeLock(
  ref: RefObject<View | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    // react-native-web's View ref is the DOM element.
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") {
      return;
    }
    let startX = 0;
    let startY = 0;
    let decision: "none" | "sideways" | "vertical" = "none";
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        decision = "vertical"; // pinch or several fingers: leave to the browser
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      decision = "none";
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || decision === "vertical") {
        return;
      }
      if (decision === "none") {
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (Math.max(dx, dy) < DECIDE_AFTER) {
          return;
        }
        decision = dx > dy ? "sideways" : "vertical";
      }
      if (decision === "sideways" && event.cancelable) {
        event.preventDefault();
      }
    };
    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
    };
  }, [ref, active]);
}
