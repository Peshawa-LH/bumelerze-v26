import { useLocalSearchParams } from "expo-router";

import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadProfileArea } from "@/features/profile/area-loader";

// On the web, downloaded on first use (src/features/profile/area.ts).
const HomeReportScreen = lazyScreenContent(
  loadProfileArea,
  (area) => area.HomeReportScreen,
);

/** The automatic building report of one home. */
export default function HomeReportRoute() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  return <HomeReportScreen tagId={tagId} />;
}
