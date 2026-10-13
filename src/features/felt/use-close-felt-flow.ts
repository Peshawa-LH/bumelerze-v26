import { useNavigation, useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * Closes the WHOLE felt-report flow and returns to where it was opened from
 * (Home, an event page, ...), whichever screen of the flow is showing.
 *
 * The flow is one modal entry in the root stack with its own stack inside
 * (`app/felt-report/_layout.tsx`). `router.dismiss()` only popped ONE screen
 * of that inner stack, so "Close" on the thank-you screen went back into the
 * flow (review notes 3.2/3.1, 2026-10-13: the owner landed on the first
 * report screen again and re-sent reports from there). Going back from the
 * flow's own entry in the parent stack removes the modal and every screen
 * in it at once. Opened cold from a link (nothing underneath), it falls
 * back to Home.
 */
export function useCloseFeltFlow(): () => void {
  const navigation = useNavigation();
  const router = useRouter();
  return useCallback(() => {
    const flow = navigation.getParent();
    if (flow?.canGoBack()) {
      flow.goBack();
      return;
    }
    router.replace("/");
  }, [navigation, router]);
}
