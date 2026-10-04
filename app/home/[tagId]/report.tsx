import { useLocalSearchParams } from "expo-router";

import { HomeReportScreen } from "@/features/building/components/HomeReport";

/** The automatic building report of one home. */
export default function HomeReportRoute() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  return <HomeReportScreen tagId={tagId} />;
}
