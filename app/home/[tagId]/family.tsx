import { useLocalSearchParams } from "expo-router";

import { FamilyScreen } from "@/features/building/components/FamilyScreen";

/** Members of one home: code and key to share, join requests, leave. */
export default function HomeFamilyRoute() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  return <FamilyScreen tagId={tagId} />;
}
