import { useLocalSearchParams } from "expo-router";

import { ImSafeScreen } from "@/features/safe";

/** "I'm safe" check-in (full screen, covers the tab bar). */
export default function ImSafeRoute() {
  const { event } = useLocalSearchParams<{ event?: string }>();
  return <ImSafeScreen eventParam={event} />;
}
