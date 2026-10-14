import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadProfileArea } from "@/features/profile/area-loader";

// On the web, downloaded on first use (src/features/profile/area.ts).
const JoinScreen = lazyScreenContent(loadProfileArea, (area) => area.JoinScreen);

/** Join someone else's home with its code and secret key. */
export default function JoinHomeRoute() {
  return <JoinScreen />;
}
