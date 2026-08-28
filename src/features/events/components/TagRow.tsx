import type { TFunction } from "i18next";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { agencyDisplayLabel } from "../agency-labels";
import type { EventProvider } from "../types";

/** Only the first N distinct authoring agencies get their own named tag;
 * beyond that we collapse into one "+N" tag rather than let the row
 * overflow a phone-width card (owner brief: "three named plus '+2' rather
 * than overflowing a phone card"). */
/**
 * How many agency tags a surface shows. Owner directive 2026-08-28, after
 * seeing three chips ("US EMSC GFZ") crowd a phone card: "we dont need to
 * write all teh sources one is enough". The corroboration data is still
 * collected and still worth showing, so it is split by surface rather than
 * dropped: the CARD shows the single authoritative agency, the event-detail
 * header shows the full list. `maxSourceTags` selects between them.
 */
const MAX_NAMED_SOURCE_TAGS_COMPACT = 1;
export const MAX_NAMED_SOURCE_TAGS_FULL = 3;

export interface TagRowContentProps {
  /** Fallback single-source label (today's `ProvenanceChip` behaviour),
   * used whenever the corroboration registry has nothing for this event
   * yet — no Supabase project configured, the request failed, or this
   * event simply isn't in the registry (`event_source_records`) at all.
   * Always present so the row never renders with zero source information. */
  provider: EventProvider;
  /** Distinct authoring-agency codes from `public.events_with_sources`
   * (e.g. "ISN", "AFAD", "NEIC"), first-seen order, already deduplicated
   * by `useEventSourceAgencies`. `undefined` or empty means "no
   * corroboration data for this event" — render the `provider` fallback
   * chip instead. How many of these are shown depends on the surface; see
   * `maxSourceTags`. */
  agencies?: readonly string[] | undefined;
  /** Compact (1 tag) on a list card, full (up to 3, plus "+N") on the
   * event-detail header. Defaults to compact: a card is the crowded
   * surface and the one the owner asked to quieten. */
  maxSourceTags?: number;
  /** Unchanged behaviour: Home's adaptive-policy notable carve-out
   * (`home-feed-policy.ts`). */
  isNotable?: boolean;
  /** Slot for a future "this event has a shakemap" tag (owner brief:
   * "in the future we can mark events that have a shakemap"). Always
   * `false` today — no caller has a data source for it yet — but the
   * rendering path exists so wiring a real signal later is a one-line
   * prop change, not a new component. */
  hasShakemap?: boolean;
}

interface TagRowContent {
  sourceTagLabels: string[];
  remainingCount: number;
  notableLabel: string | null;
  shakemapLabel: string | null;
  a11yLabel: string;
}

/** Pure content computation, shared by `TagRow`'s own standalone render and
 * by `EventCard`, which folds the same sentence into its single card-wide
 * `accessibilityLabel` instead of letting this component claim its own
 * accessible node (see `TagRow`'s `standalone` prop doc comment). */
function computeTagRowContent(
  {
    provider,
    agencies,
    isNotable = false,
    hasShakemap = false,
    maxSourceTags = MAX_NAMED_SOURCE_TAGS_COMPACT,
  }: TagRowContentProps,
  t: TFunction,
): TagRowContent {
  const namedAgencies = (agencies ?? [])
    .slice(0, maxSourceTags)
    .map(agencyDisplayLabel);
  // The compact surface (list banners) shows exactly three tag kinds and no
  // more: source, notable, shakemap. Owner directive 2026-08-28, tightened
  // after a first pass rendered "US +2": "one source tagged the main one
  // thats enough ... for the banners only one tag for the source". So the
  // "+N" collapse exists only where the full list does, on event detail.
  // The spoken label follows the visual rather than quietly adding "and N
  // more", so a screen-reader user hears what a sighted user sees.
  const showsRemainderTag = maxSourceTags > MAX_NAMED_SOURCE_TAGS_COMPACT;
  const remainingCount = showsRemainderTag
    ? Math.max((agencies?.length ?? 0) - namedAgencies.length, 0)
    : 0;

  const sourceTagLabels =
    namedAgencies.length > 0
      ? namedAgencies
      : // No registry match yet — today's single provider chip.
        [t(`events.provenance.${provider}`)];

  const notableLabel = isNotable ? t("events.notableTag") : null;
  const shakemapLabel = hasShakemap ? t("events.shakemapTag") : null;

  const sourcesA11yText =
    remainingCount > 0
      ? t("events.tagRow.sourcesWithMoreA11yLabel", {
          agencies: sourceTagLabels.join(", "),
          count: remainingCount,
        })
      : t("events.tagRow.sourcesA11yLabel", {
          agencies: sourceTagLabels.join(", "),
        });

  const a11yLabel = [
    sourcesA11yText,
    notableLabel,
    hasShakemap ? t("events.shakemapTagA11yLabel") : null,
  ]
    .filter(Boolean)
    .join(". ");

  return { sourceTagLabels, remainingCount, notableLabel, shakemapLabel, a11yLabel };
}

/** Exported for `EventCard`: it already wraps the whole card in one
 * `Pressable` with `accessibilityRole="button"` and one combined
 * `accessibilityLabel` (magnitude, place, time, ...) — this returns just
 * the sources/notable/shakemap sentence so it can be appended to that same
 * label instead of TagRow claiming a second, confusingly-scoped
 * accessible node nested inside the card's own. */
export function buildTagRowAccessibilityLabel(
  props: TagRowContentProps,
  t: TFunction,
): string {
  return computeTagRowContent(props, t).a11yLabel;
}

interface TagRowProps extends TagRowContentProps {
  /** `true` (default): this row is its own accessible element with a
   * combined label — the right behaviour for the two places it renders on
   * its own (the event-detail header, the map preview sheet). `false`:
   * skip the wrapping `accessible`/`accessibilityLabel` entirely and just
   * render the (individually a11y-hidden) pills — for `EventCard`, whose
   * enclosing `Pressable` already owns one combined label for the whole
   * card via `buildTagRowAccessibilityLabel` above. */
  standalone?: boolean;
}

/**
 * The event card / event-detail header's small-tag row (owner brief,
 * 2026-08-28: "currently ... there is a tag for source USGS ... this
 * tabbing I like we should keep for the sources especially and in the
 * future we can mark events that have a shakemap"). Generalises the old
 * ad-hoc `ProvenanceChip` + inline "notable" tag pairing into one ordered
 * row: source tag(s), then notable, then shakemap.
 *
 * In `standalone` mode this is ONE accessible element with a combined label
 * (typescript-react-native.md: screen readers should hear a sentence, not
 * disconnected fragments) — the individual pill `Text`s are always hidden
 * from the accessibility tree, the same way `EventPreviewSheet`'s
 * grab-handle row already does (`accessibilityElementsHidden` +
 * `importantForAccessibility = "no-hide-descendants"`, the two-prop combo
 * RN needs for iOS+Android).
 */
export function TagRow({ standalone = true, ...contentProps }: TagRowProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  const { sourceTagLabels, remainingCount, notableLabel, shakemapLabel, a11yLabel } =
    computeTagRowContent(contentProps, t);

  const a11yProps = standalone
    ? { accessible: true as const, accessibilityLabel: a11yLabel }
    : {};

  return (
    <View {...a11yProps} style={[styles.row, { gap: spacing[1] }]}>
      {sourceTagLabels.map((label, index) => (
        <Tag
          key={`source-${index}-${label}`}
          label={label}
          textColor={colors.text.secondary}
          borderColor={colors.border.default}
          backgroundColor={colors.surface.sunken}
          typography={typography}
          spacing={spacing}
        />
      ))}
      {remainingCount > 0 ? (
        <Tag
          label={t("events.tagRow.moreSourcesTag", { count: remainingCount })}
          textColor={colors.text.secondary}
          borderColor={colors.border.default}
          backgroundColor={colors.surface.sunken}
          typography={typography}
          spacing={spacing}
        />
      ) : null}
      {notableLabel ? (
        <Tag
          label={notableLabel}
          textColor={colors.status.info}
          borderColor={colors.status.info}
          typography={typography}
          spacing={spacing}
        />
      ) : null}
      {shakemapLabel ? (
        <Tag
          label={shakemapLabel}
          textColor={colors.status.success}
          borderColor={colors.status.success}
          typography={typography}
          spacing={spacing}
        />
      ) : null}
    </View>
  );
}

interface TagProps {
  label: string;
  textColor: string;
  borderColor: string;
  backgroundColor?: string;
  typography: ReturnType<typeof useTheme>["typography"];
  spacing: ReturnType<typeof useTheme>["spacing"];
}

/** One pill — always hidden from the accessibility tree individually;
 * whichever ancestor owns the combined label (this row itself in
 * `standalone` mode, or `EventCard`'s outer `Pressable` otherwise) is what
 * every screen reader actually hears. */
function Tag({ label, textColor, borderColor, backgroundColor, typography, spacing }: TagProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.chip,
        {
          borderColor,
          backgroundColor,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[1] / 2,
        },
      ]}
    >
      <Text
        allowFontScaling
        style={{
          color: textColor,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
});
