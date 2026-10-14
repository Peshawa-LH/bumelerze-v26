import { useLocalSearchParams } from "expo-router";

import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadProfileArea } from "@/features/profile/area-loader";

// On the web, downloaded on first use (src/features/profile/area.ts).
const NewHomeScreen = lazyScreenContent(loadProfileArea, (area) => area.NewHomeScreen);

/** "Tag my building" (accounts only). With `?tagId=` it retakes the
 * questions of an existing home. */
export default function NewHomeRoute() {
  const { tagId } = useLocalSearchParams<{ tagId?: string }>();
  return <NewHomeScreen tagId={tagId} />;
}
