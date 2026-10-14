import { useLocalSearchParams } from "expo-router";

import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadProfileArea } from "@/features/profile/area-loader";

// On the web, downloaded on first use (src/features/profile/area.ts).
const FamilyScreen = lazyScreenContent(loadProfileArea, (area) => area.FamilyScreen);

/** Members of one home: code and key to share, join requests, leave. */
export default function HomeFamilyRoute() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  return <FamilyScreen tagId={tagId} />;
}
