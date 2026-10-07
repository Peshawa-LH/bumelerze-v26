import { useState } from "react";
import { View } from "react-native";

import { EventCard } from "@/features/events";
import { useTheme } from "@/theme";

import { buildSampleEvents } from "../../sample-events";

const noop = () => undefined;

/** Home: two sample earthquakes drawn by the real feed card. */
export function HomePreview() {
  const { spacing } = useTheme();
  const [now] = useState(() => Date.now());
  const [first, second] = buildSampleEvents(now);
  return (
    <View style={{ gap: spacing[3] }}>
      <EventCard event={first} onPress={noop} now={now} />
      <EventCard event={second} onPress={noop} now={now} />
    </View>
  );
}
