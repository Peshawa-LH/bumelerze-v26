import { useLocalSearchParams } from "expo-router";

import { NewHomeScreen } from "@/features/building/components/NewHomeScreen";

/** "Tag my building" (accounts only). With `?tagId=` it retakes the
 * questions of an existing home. */
export default function NewHomeRoute() {
  const { tagId } = useLocalSearchParams<{ tagId?: string }>();
  return <NewHomeScreen tagId={tagId} />;
}
