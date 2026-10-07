import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** The system "reduce motion" setting, kept live. False until it is read. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduce(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        if (alive) setReduce(value);
      },
    );
    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);
  return reduce;
}
