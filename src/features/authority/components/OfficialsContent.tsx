import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAdminAccess } from "@/features/admin/queries";
import { areaName } from "@/features/admin/stats/area-name";
import { VcRows, useNumber } from "@/features/admin/stats/charts";
import {
  ChoiceChips,
  ToolCard,
  ToolPage,
  ToolSectionTitle,
  useTextDir,
} from "@/features/admin/ui";
import { VC_COLORS } from "@/features/building/components/VcBadge";
import { VULNERABILITY_CLASSES } from "@/features/building/ims25";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import {
  formatAbsoluteDual,
  formatDateOnly,
  formatMagnitudeValue,
  isolateNumeric,
} from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useAuthorityOverview, useEventSafety, useSharedPeople } from "../queries";
import type { AuthorityTransport } from "../transport";
import type { AreaClasses, CheckinEvent, SharedPerson } from "../types";

/**
 * The Officials page (owner decision 2026-10-13): for holders of the
 * Government official rank only. Aggregates first (tagged homes by
 * vulnerability class, by area; who checked in safe after an earthquake, by
 * area), the people who chose to share second, and only after a tap. Every
 * number under 5 is hidden by the server; every read is recorded in the
 * activity log. Never a name without the person's own switch, never a
 * coordinate or an address.
 */
export function OfficialsContent({
  transport,
  hubTransport,
}: {
  transport?: AuthorityTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const dir = useTextDir();
  const access = useAdminAccess(hubTransport);
  const allowed = access.has("authority.view");
  const overview = useAuthorityOverview(allowed, transport);
  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];

  if (!allowed) {
    return access.isLoading ? null : (
      <ToolPage testID="officials-page">
        <Text style={meta} testID="officials-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </ToolPage>
    );
  }

  return (
    <ToolPage
      testID="officials-page"
      hint={t("officials.hint")}
      footer={t("officials.footer")}
    >
      {overview.isLoading ? (
        <Text style={meta} testID="officials-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : overview.isError || !overview.data ? (
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="officials-error"
          >
            {communityErrorText(t, overview.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void overview.refetch()}
            testID="officials-retry"
          />
        </View>
      ) : (
        <>
          <ToolCard
            title={t("officials.buildingsTitle")}
            subtitle={t("officials.buildingsSubtitle")}
            testID="officials-buildings"
          >
            <VcRows counts={overview.data.classes} testID="officials-vc" />
          </ToolCard>
          <ToolCard
            title={t("officials.areasTitle")}
            subtitle={t("officials.areasSubtitle")}
            testID="officials-areas"
          >
            {overview.data.areas.length === 0 ? (
              <Text style={meta} testID="officials-areas-empty">
                {t("officials.areasEmpty")}
              </Text>
            ) : (
              overview.data.areas.map((row) => <AreaRow key={row.area} row={row} />)
            )}
          </ToolCard>
          <SafetyCard events={overview.data.events} transport={transport} />
          <PeopleSection transport={transport} />
        </>
      )}
    </ToolPage>
  );
}

/** One area: its name, then the six classes as small letter chips with the
 * count under each ("<5" when hidden; the spoken label says it in words). */
function AreaRow({ row }: { row: AreaClasses }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const num = useNumber();
  const name = areaName(row.area, i18n.language, t);
  const less = localizeDigits("<5", i18n.language);
  return (
    <View style={{ gap: spacing[1] }} testID={`officials-area-${row.area}`}>
      <Text
        style={[typography.bodyDefault, dir, styles.bold, { color: colors.text.primary }]}
      >
        {name}
      </Text>
      <View style={[styles.cells, { gap: spacing[2] }]}>
        {VULNERABILITY_CLASSES.map((vc) => {
          const value = row.classes[vc];
          return (
            <View
              key={vc}
              accessible
              accessibilityLabel={t("admin.stats.classA11y", {
                vc,
                name: t(`building.vc.name.${vc}`),
                count: value === null ? t("officials.fewerThan5") : num(value),
              })}
              style={styles.cell}
              testID={`officials-area-${row.area}-${vc}`}
            >
              <View style={[styles.chip, { backgroundColor: VC_COLORS[vc].fill }]}>
                <Text
                  style={[
                    typography.labelCaption,
                    styles.bold,
                    { color: VC_COLORS[vc].text },
                  ]}
                >
                  {vc}
                </Text>
              </View>
              <Text
                style={[
                  typography.labelCaption,
                  { color: value === null ? colors.text.tertiary : colors.text.primary },
                ]}
              >
                {value === null ? less : num(value)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function eventLabel(
  event: Pick<CheckinEvent, "magnitude" | "place" | "originTime">,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return [
    event.magnitude !== null
      ? t("admin.hubs.magnitude", {
          value: isolateNumeric(formatMagnitudeValue(event.magnitude, locale)),
        })
      : null,
    event.place,
    formatDateOnly(event.originTime, locale, t),
  ]
    .filter(Boolean)
    .join(" · ");
}

function SafetyCard({
  events,
  transport,
}: {
  events: readonly CheckinEvent[];
  transport: AuthorityTransport | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const router = useRouter();
  const num = useNumber();
  const [eventId, setEventId] = useState<string | null>(events[0]?.eventId ?? null);
  const safety = useEventSafety(eventId, transport);
  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  const chosen = events.find((e) => e.eventId === eventId) ?? null;

  return (
    <ToolCard
      title={t("officials.safetyTitle")}
      subtitle={t("officials.safetySubtitle")}
      testID="officials-safety"
    >
      {events.length === 0 ? (
        <Text style={meta} testID="officials-safety-empty">
          {t("officials.safetyEmpty")}
        </Text>
      ) : (
        <>
          <ChoiceChips
            label={t("officials.chooseEvent")}
            options={events.map((e) => ({
              value: e.eventId,
              label: eventLabel(e, i18n.language, t),
            }))}
            value={eventId}
            onChange={setEventId}
            testID="officials-events"
          />
          {safety.isLoading ? (
            <Text style={meta}>{t("eventDetail.loading")}</Text>
          ) : safety.isError || !safety.data ? (
            <Text
              accessibilityRole="alert"
              style={[meta, { color: colors.status.danger }]}
            >
              {communityErrorText(t, safety.error)}
            </Text>
          ) : (
            <View style={{ gap: spacing[2] }} testID="officials-safety-rows">
              <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
                {safety.data.checkins === null
                  ? t("officials.totalFew")
                  : t("officials.total", { number: num(safety.data.checkins) })}
              </Text>
              {safety.data.areas.length === 0 ? (
                <Text style={meta}>{t("officials.areasEmpty")}</Text>
              ) : (
                safety.data.areas.map((row) => (
                  <View
                    key={row.area}
                    style={[styles.safetyRow, { gap: spacing[2] }]}
                    testID={`officials-safety-${row.area}`}
                  >
                    <Text
                      style={[
                        typography.bodyDefault,
                        dir,
                        styles.flex,
                        { color: colors.text.primary },
                      ]}
                    >
                      {areaName(row.area, i18n.language, t)}
                    </Text>
                    <Text
                      style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}
                    >
                      {row.safe === null
                        ? t("officials.safeFew", { people: num(row.people) })
                        : t("officials.safeOf", {
                            safe: num(row.safe),
                            people: num(row.people),
                            percent: num(
                              Math.round((row.safe / Math.max(1, row.people)) * 100),
                            ),
                          })}
                    </Text>
                  </View>
                ))
              )}
              {chosen?.bumelerzeId ? (
                <ActionButton
                  label={t("officials.feltMap")}
                  onPress={() => router.push(`/event/${chosen.bumelerzeId as string}`)}
                  testID="officials-felt-map"
                />
              ) : null}
            </View>
          )}
        </>
      )}
    </ToolCard>
  );
}

/** The opted-in people: loaded only when the official asks (each look is
 * recorded with who was shown). */
function PeopleSection({ transport }: { transport: AuthorityTransport | undefined }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const [show, setShow] = useState(false);
  const people = useSharedPeople(show, transport);
  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  return (
    <View style={{ gap: spacing[3] }} testID="officials-people">
      <ToolSectionTitle title={t("officials.peopleTitle")} />
      <Text style={meta}>{t("officials.peopleHint")}</Text>
      {!show ? (
        <AccountButton
          label={t("officials.peopleShow")}
          onPress={() => setShow(true)}
          testID="officials-people-show"
        />
      ) : people.isLoading ? (
        <Text style={meta}>{t("eventDetail.loading")}</Text>
      ) : people.isError || !people.data ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {communityErrorText(t, people.error)}
        </Text>
      ) : people.data.length === 0 ? (
        <Text style={meta} testID="officials-people-empty">
          {t("officials.peopleEmpty")}
        </Text>
      ) : (
        people.data.map((person) => <PersonCard key={person.userId} person={person} />)
      )}
    </View>
  );
}

function PersonCard({ person }: { person: SharedPerson }) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const dir = useTextDir();
  const locale = i18n.language;
  const name =
    person.displayName ??
    (person.username ? `@${person.username}` : t("officials.noName"));
  return (
    <ToolCard testID={`officials-person-${person.userId}`}>
      <View>
        <Text
          style={[
            typography.bodyDefault,
            dir,
            styles.bold,
            { color: colors.text.primary },
          ]}
        >
          {name}
        </Text>
        {person.username && person.displayName ? (
          <Text
            style={[
              typography.bodyMeta,
              {
                color: colors.text.secondary,
                writingDirection: "ltr",
                textAlign: "left",
              },
            ]}
          >
            @{person.username}
          </Text>
        ) : null}
      </View>
      {person.homes.length === 0 ? (
        <Text style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}>
          {t("officials.noHome")}
        </Text>
      ) : (
        person.homes.map((home, index) => (
          <Text
            key={index}
            style={[typography.bodyMeta, dir, { color: colors.text.primary }]}
            testID={`officials-person-home-${person.userId}-${index}`}
          >
            {[
              home.vc
                ? home.vcRange
                  ? t("officials.homeClassRange", {
                      vc: home.vc,
                      name: t(`building.vc.name.${home.vc}`),
                      range: isolateNumeric(home.vcRange),
                    })
                  : t("officials.homeClass", {
                      vc: home.vc,
                      name: t(`building.vc.name.${home.vc}`),
                    })
                : t("officials.homeNoClass"),
              t("officials.homeArea", { area: areaName(home.area, locale, t) }),
              home.kind ? t(`building.kinds.${home.kind}`) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ))
      )}
      <Text
        style={[
          typography.bodyMeta,
          dir,
          { color: person.safe ? colors.status.success : colors.text.secondary },
        ]}
        testID={`officials-person-safe-${person.userId}`}
      >
        {person.safe
          ? t("officials.safeAt", {
              time: formatAbsoluteDual(person.safe.checkedInAt, locale, t).local,
              event: eventLabel(
                {
                  magnitude: person.safe.magnitude,
                  place: person.safe.place,
                  originTime: person.safe.originTime ?? person.safe.checkedInAt,
                },
                locale,
                t,
              ),
            })
          : t("officials.noSafe")}
      </Text>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: "700" },
  cells: { flexDirection: "row", flexWrap: "wrap" },
  cell: { alignItems: "center", gap: 2, minWidth: 36 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  safetyRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  flex: { flex: 1 },
});
