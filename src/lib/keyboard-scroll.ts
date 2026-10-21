import { Platform } from "react-native";

/**
 * iOS/Android: spread on the scroll view (ScrollView or FlatList) of a
 * screen that holds a text field, so the field never sits under the
 * keyboard (item 47 of the iOS parity inventory).
 *
 * - `automaticallyAdjustKeyboardInsets` (iOS) insets the content by the part
 *   the keyboard covers and scrolls the focused field above it.
 * - `keyboardShouldPersistTaps: "handled"`: a tap on a button or a search
 *   result while the keyboard is up does its job at once instead of only
 *   closing the keyboard.
 *
 * Empty on the web: the browser scrolls the focused field into view itself,
 * and react-native-web's ScrollView would otherwise stop blurring a field
 * when the page around it is tapped.
 *
 * Bottom sheets and docked composers use a `KeyboardAvoidingView` instead
 * (`admin/people/components/Sheet.tsx`, `ShareSheet`, the hub's composer).
 */
export const KEYBOARD_AWARE_SCROLL: {
  automaticallyAdjustKeyboardInsets?: boolean;
  keyboardShouldPersistTaps?: "handled";
} =
  Platform.OS === "web"
    ? {}
    : { automaticallyAdjustKeyboardInsets: true, keyboardShouldPersistTaps: "handled" };
