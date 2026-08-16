import { useTranslation } from "react-i18next";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";

/**
 * Native (iOS/Android) Map tab — the interactive MapLibre map is web-first
 * this wave (see `map.web.tsx`'s doc comment for the full reasoning): the
 * native MapLibre module needs a dev build, which needs the owner's Expo
 * account, which isn't set up yet. Metro's platform-extension resolution
 * (`map.web.tsx` vs. this bare `map.tsx`) means native never even sees, let
 * alone bundles, `maplibre-gl` or its web-only module graph — this file has
 * no import of anything web-only.
 *
 * A real, translated state (not a TODO string) — the app must never show
 * placeholder English on a real device regardless of locale.
 */
export default function MapScreen() {
  const { t } = useTranslation();
  return (
    <EmptyStateScreen
      title={t("map.title")}
      description={t("map.nativeUnavailableDescription")}
    />
  );
}
