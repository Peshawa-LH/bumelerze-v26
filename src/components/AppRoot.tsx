import type { ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

/**
 * The view around the whole app. iOS/Android: gesture-handler's root view,
 * which its gestures need. The web version (`AppRoot.web.tsx`) is a plain
 * view that also tells react-native-web the reading direction.
 */
export function AppRoot({ children }: { children: ReactNode }) {
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;
}
