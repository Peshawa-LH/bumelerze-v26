import { Platform, type AccessibilityState, type ViewProps } from "react-native";

/**
 * The state of a control (checked, expanded, selected, disabled, busy) for
 * assistive technology, on every platform.
 *
 * iOS/Android read `accessibilityState`. react-native-web (0.19+) ignores it
 * and reads the `aria-*` props instead (which React Native itself also
 * accepts), so a radio or checkbox with only `accessibilityState` had no
 * `aria-checked` in the DOM: a screen-reader user could not tell which
 * language, appearance or alert tier was chosen (review B-4, A-8). Spread
 * the result onto the Pressable/View:
 *
 *   <Pressable accessibilityRole="radio" {...a11yState({ checked: isActive })} />
 *
 * On the phone this is exactly `{ accessibilityState }` (nothing changes);
 * on the web the matching `aria-*` attributes are added.
 */
export type A11yStateProps = { accessibilityState: AccessibilityState } & Pick<
  ViewProps,
  "aria-busy" | "aria-checked" | "aria-disabled" | "aria-expanded" | "aria-selected"
>;

export function a11yState(state: AccessibilityState): A11yStateProps {
  const props: A11yStateProps = { accessibilityState: state };
  if (Platform.OS !== "web") {
    return props;
  }
  if (state.checked !== undefined) props["aria-checked"] = state.checked;
  if (state.selected !== undefined) props["aria-selected"] = state.selected;
  if (state.expanded !== undefined) props["aria-expanded"] = state.expanded;
  if (state.disabled !== undefined) props["aria-disabled"] = state.disabled;
  if (state.busy !== undefined) props["aria-busy"] = state.busy;
  return props;
}
