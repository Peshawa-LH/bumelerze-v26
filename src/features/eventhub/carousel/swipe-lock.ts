import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * Web only (`swipe-lock.web.ts`): keeps the page from scrolling while a
 * finger swipes the carousel sideways. iOS/Android: nothing to do, the
 * responder system already gives the swipe to the carousel.
 */
export function useHorizontalSwipeLock(
  _ref: RefObject<View | null>,
  _active: boolean,
): void {}
