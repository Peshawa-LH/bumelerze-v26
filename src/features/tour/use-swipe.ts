import { useEffect, useRef, useState } from "react";
import { PanResponder, type PanResponderInstance } from "react-native";

import { swipeStep } from "./swipe";

/** How far sideways a drag must go before the tour claims it (a vertical
 * scroll of the card must keep working). */
const CLAIM_DX = 12;

/**
 * Pan handlers that turn a finished horizontal drag into a tour step
 * (`swipeStep`: +1 next, -1 back, reading-order aware). The responder is
 * created once; it reads the latest callback and direction from an ref that is
 * refreshed after every render, so it never goes stale.
 */
export function useSwipe(
  onStep: (delta: -1 | 1) => void,
  rtl: boolean,
): PanResponderInstance["panHandlers"] {
  const latest = useRef({ onStep, rtl });
  useEffect(() => {
    latest.current = { onStep, rtl };
  });

  // eslint-disable-next-line react-hooks/refs -- the ref is only read inside the responder's event callbacks
  const [responder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > CLAIM_DX &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      // Reads the ref when a drag ends (an event), never while rendering.
      onPanResponderRelease: (_event, gesture) => {
        const step = swipeStep(gesture.dx, gesture.vx, latest.current.rtl);
        if (step !== 0) {
          latest.current.onStep(step);
        }
      },
    }),
  );
  return responder.panHandlers;
}
