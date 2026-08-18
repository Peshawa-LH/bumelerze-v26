import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the user prefers reduced motion — `AccessibilityInfo` (core React
 * Native, not a new dependency) is the one API that already answers this
 * correctly on every platform this app ships to: native reads the OS-level
 * "Reduce Motion" setting, and react-native-web's own implementation reads
 * `window.matchMedia('(prefers-reduced-motion: reduce)')` under the hood —
 * so this hook needs no `Platform.OS`/`window` branching of its own
 * (`EventPreviewSheet.tsx`'s only reduced-motion dependency).
 *
 * Starts `false` and flips to the real value once the initial async query
 * resolves (there is no synchronous read on any platform) — a one-frame
 * "assume motion is fine" default is an acceptable trade for never
 * blocking first paint on it; `addEventListener("reduceMotionChanged")`
 * keeps it live if the user changes the OS/browser setting mid-session.
 */
export function useReducedMotionPreference(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) {
        setPrefersReducedMotion(value);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => setPrefersReducedMotion(value),
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return prefersReducedMotion;
}
