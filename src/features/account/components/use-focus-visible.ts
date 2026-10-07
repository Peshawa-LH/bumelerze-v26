import { useCallback, useState } from "react";

/**
 * Web only: `:focus-visible` semantics for React Native Web, which has no
 * such pseudo-class on a `Pressable`. A tap on a touch screen (iOS Safari
 * especially) focuses the element just like a Tab key does, and a focus ring
 * drawn on every focus then shows as a heavy outline after each tap. So the
 * ring is drawn only when the most recent interaction was a key press.
 *
 * One pair of capture-phase listeners is installed at module load and records
 * the last input modality; they are passive and cost nothing per render. On
 * native (no `document`) nothing is installed and the hook never reports a
 * visible focus, which is right: there is no keyboard-focus ring to draw.
 */
let lastInteractionWasKeyboard = false;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener(
    "keydown",
    (event: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(event.key)) {
        lastInteractionWasKeyboard = true;
      }
    },
    true,
  );
  const onPointer = () => {
    lastInteractionWasKeyboard = false;
  };
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("mousedown", onPointer, true);
  document.addEventListener("touchstart", onPointer, true);
}

/** Test seam: set the recorded input modality. */
export function setLastInteractionWasKeyboard(value: boolean): void {
  lastInteractionWasKeyboard = value;
}

export function useFocusVisible() {
  const [focusVisible, setFocusVisible] = useState(false);
  const onFocus = useCallback(() => {
    setFocusVisible(lastInteractionWasKeyboard);
  }, []);
  const onBlur = useCallback(() => setFocusVisible(false), []);
  return { focusVisible, onFocus, onBlur };
}
