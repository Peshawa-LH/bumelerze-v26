import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAdminAccess } from "@/features/admin/queries";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { formatMagnitudeValue } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import {
  useContentFilterActions,
  useFilterTerms,
  useSurgeStatus,
  type ContentFilterActions,
} from "../queries";
import {
  SupabaseContentFilterTransport,
  filterInputProblem,
  type ContentFilterTransport,
} from "../transport";
import {
  FILTER_KINDS,
  FILTER_LANGS,
  type FilterKind,
  type FilterLang,
  type FilterTerm,
  type FilterTestResult,
  type SurgeMode,
  type SurgeStatus,
} from "../types";

/** Longest word or phrase the server accepts. */
export const FILTER_TERM_MAX_LENGTH = 100;

/**
 * Admin > Word filter and busy times (migration 0059, `filter.manage`, the
 * official account only). Busy-time review on top (automatic, or forced on or
 * off for 24 hours), then "Would this be held?", adding a word or phrase, and
 * the list with Switch off / Switch on (a starter term also gets Keep). A
 * match never deletes anything: the comment or post waits for review.
 */
export function ContentFilterContent({
  transport = SupabaseContentFilterTransport,
  hubTransport,
}: {
  transport?: ContentFilterTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const allowed = access.has("filter.manage");
  const terms = useFilterTerms(allowed, transport);
  const surge = useSurgeStatus(allowed, transport);
  const actions = useContentFilterActions(transport);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!allowed) {
    return (
      <View style={{ padding: spacing[4] }}>
        {access.isLoading ? null : (
          <Text style={meta} testID="filter-no-access">
            {t("community.errors.forbidden")}
          </Text>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[5],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
      testID="filter-screen"
    >
      <Text style={meta}>{t("contentFilter.hint")}</Text>
      <SurgeCard status={surge.data ?? null} actions={actions} />
      <TestBox transport={transport} />
      <AddTermForm actions={actions} />
      <View style={{ gap: spacing[2] }} testID="filter-list">
        <Text
          accessibilityRole="header"
          style={[typography.h3, { color: colors.text.primary }]}
        >
          {t("contentFilter.list.title")}
        </Text>
        {terms.isLoading ? (
          <Text style={meta}>{t("eventDetail.loading")}</Text>
        ) : terms.isError ? (
          <Text style={meta}>{communityErrorText(t, terms.error)}</Text>
        ) : (terms.data ?? []).length === 0 ? (
          <Text style={meta}>{t("contentFilter.list.empty")}</Text>
        ) : (
          (terms.data ?? []).map((term) => (
            <TermRow key={term.id} term={term} actions={actions} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function useBusy() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      return true;
    } catch (error) {
      const problem = filterInputProblem(error);
      setErrorText(
        problem ? t(`contentFilter.errors.${problem}`) : communityErrorText(t, error),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, errorText, run };
}

function Card({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      {children}
    </View>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  const { colors, typography } = useTheme();
  if (!text) {
    return null;
  }
  return (
    <Text
      accessibilityRole="alert"
      style={{
        color: colors.status.danger,
        fontSize: typography.bodyMeta.fontSize,
        lineHeight: typography.bodyMeta.lineHeight,
      }}
    >
      {text}
    </Text>
  );
}

/** What busy-time review is doing now, and the three-way switch. */
function SurgeCard({
  status,
  actions,
}: {
  status: SurgeStatus | null;
  actions: ContentFilterActions;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { busy, errorText, run } = useBusy();
  const locale = i18n.language;
  const body = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const magnitudeText = (value: number) =>
    t("events.magnitudeDisplay", { value: formatMagnitudeValue(value, locale) });
  const explain = t("contentFilter.surge.explain", {
    magnitude: magnitudeText(status?.minMagnitude ?? 5),
    reports: localizeDigits(String(status?.feltReports ?? 50), locale),
    days: localizeDigits(String(status?.accountDays ?? 7), locale),
  });

  let now = t("contentFilter.surge.inactive");
  if (status?.active && status.reason === "magnitude") {
    now = t("contentFilter.surge.activeMagnitude", {
      magnitude: magnitudeText(status.magnitude ?? 0),
      place: status.place ?? status.eventRef ?? "",
    });
  } else if (status?.active && status.reason === "felt") {
    now = t("contentFilter.surge.activeFelt", {
      number: localizeDigits(String(status.reports ?? 0), locale),
      place: status.place ?? status.eventRef ?? "",
    });
  } else if (status?.active) {
    now = t("contentFilter.surge.activeManual");
  } else if (status?.mode === "off") {
    now = t("contentFilter.surge.offManual");
  }
  const until =
    status?.until !== null && status?.until !== undefined
      ? t("contentFilter.surge.until", {
          time: new Date(status.until).toLocaleString(locale, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })
      : null;

  const modes: SurgeMode[] = ["auto", "on", "off"];
  return (
    <Card testID="filter-surge">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("contentFilter.surge.title")}
      </Text>
      <Text style={meta}>{explain}</Text>
      <Text style={[body, { fontWeight: "600" }]} testID="filter-surge-now">
        {now}
        {until ? ` ${until}` : ""}
      </Text>
      <View style={styles.row}>
        {modes.map((mode) => (
          <ActionButton
            key={mode}
            label={t(`contentFilter.surge.modes.${mode}`)}
            selected={(status?.mode ?? "auto") === mode}
            disabled={busy || status === null}
            onPress={() => void run(() => actions.setSurgeMode(mode))}
            testID={`filter-surge-${mode}`}
          />
        ))}
      </View>
      <ErrorLine text={errorText} />
    </Card>
  );
}

/** "Would this be held?" Nothing is stored. */
function TestBox({ transport }: { transport: ContentFilterTransport }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [text, setText] = useState("");
  const [result, setResult] = useState<FilterTestResult | null>(null);
  const { busy, errorText, run } = useBusy();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  return (
    <Card testID="filter-test">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("contentFilter.test.title")}
      </Text>
      <TextInput
        value={text}
        onChangeText={(value) => {
          setText(value);
          setResult(null);
        }}
        multiline
        maxLength={1000}
        placeholder={t("contentFilter.test.placeholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("contentFilter.test.label")}
        testID="filter-test-input"
        textAlignVertical="top"
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.base,
            fontSize: typography.bodyDefault.fontSize,
            padding: spacing[3],
            textAlign: "auto",
          },
        ]}
      />
      <View style={styles.row}>
        <ActionButton
          label={t("contentFilter.test.button")}
          disabled={busy || text.trim() === ""}
          onPress={() =>
            void run(async () => setResult(await transport.testText(text.trim())))
          }
          testID="filter-test-run"
        />
      </View>
      {result ? (
        <View style={{ gap: spacing[1] }} accessibilityLiveRegion="polite">
          <Text
            testID="filter-test-result"
            style={[
              typography.bodyDefault,
              { color: colors.text.primary, fontWeight: "600" },
            ]}
          >
            {result.held ? t("contentFilter.test.held") : t("contentFilter.test.notHeld")}
          </Text>
          {result.matches.length > 0 ? (
            <Text style={meta} testID="filter-test-matches">
              {t("contentFilter.test.matched", {
                terms: result.matches
                  .map(
                    (m) =>
                      `${m.isPattern ? t("contentFilter.list.pattern") : m.term} (${t(`contentFilter.kinds.${m.kind}`)})`,
                  )
                  .join(", "),
              })}
            </Text>
          ) : null}
          {result.surge ? (
            <Text style={meta}>{t("contentFilter.test.surgeNote")}</Text>
          ) : null}
        </View>
      ) : null}
      <ErrorLine text={errorText} />
    </Card>
  );
}

function AddTermForm({ actions }: { actions: ContentFilterActions }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [term, setTerm] = useState("");
  const [lang, setLang] = useState<FilterLang>("ckb");
  const [kind, setKind] = useState<FilterKind>("prediction");
  const [done, setDone] = useState(false);
  const { busy, errorText, run } = useBusy();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const trimmed = term.trim();
  return (
    <Card testID="filter-add">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("contentFilter.add.title")}
      </Text>
      <Text style={meta}>{t("contentFilter.add.hint")}</Text>
      <TextInput
        value={term}
        onChangeText={(value) => {
          setTerm(value);
          setDone(false);
        }}
        maxLength={FILTER_TERM_MAX_LENGTH}
        placeholder={t("contentFilter.add.placeholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("contentFilter.add.label")}
        autoCapitalize="none"
        autoCorrect={false}
        testID="filter-add-input"
        style={[
          styles.line,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.base,
            fontSize: typography.bodyDefault.fontSize,
            paddingHorizontal: spacing[3],
            textAlign: "auto",
          },
        ]}
      />
      <Text style={meta}>{t("contentFilter.add.lang")}</Text>
      <View style={styles.row}>
        {FILTER_LANGS.map((value) => (
          <ActionButton
            key={value}
            label={t(`contentFilter.langs.${value}`)}
            selected={lang === value}
            onPress={() => setLang(value)}
            testID={`filter-add-lang-${value}`}
          />
        ))}
      </View>
      <Text style={meta}>{t("contentFilter.add.kind")}</Text>
      <View style={styles.row}>
        {FILTER_KINDS.map((value) => (
          <ActionButton
            key={value}
            label={t(`contentFilter.kinds.${value}`)}
            selected={kind === value}
            onPress={() => setKind(value)}
            testID={`filter-add-kind-${value}`}
          />
        ))}
      </View>
      <View style={styles.row}>
        <ActionButton
          label={t("contentFilter.add.button")}
          disabled={busy || trimmed.length < 2}
          onPress={() =>
            void run(() => actions.addTerm(trimmed, lang, kind)).then((ok) => {
              if (ok) {
                setTerm("");
                setDone(true);
              }
            })
          }
          testID="filter-add-submit"
        />
      </View>
      {done ? (
        <Text style={meta} accessibilityLiveRegion="polite" testID="filter-add-done">
          {t("contentFilter.add.added")}
        </Text>
      ) : null}
      <ErrorLine text={errorText} />
    </Card>
  );
}

function TermRow({ term, actions }: { term: FilterTerm; actions: ContentFilterActions }) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const { busy, errorText, run } = useBusy();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const details = [
    t(`contentFilter.kinds.${term.kind}`),
    t(`contentFilter.langs.${term.lang}`),
    term.isPattern ? t("contentFilter.list.pattern") : null,
    term.draft ? t("contentFilter.list.draft") : null,
    term.active ? null : t("contentFilter.list.off"),
    term.holds30d > 0
      ? t("contentFilter.list.holds", {
          number: localizeDigits(String(term.holds30d), i18n.language),
        })
      : null,
  ].filter(Boolean);
  return (
    <Card testID={`filter-term-${term.id}`}>
      <Text
        style={[
          typography.bodyDefault,
          {
            color: term.active ? colors.text.primary : colors.text.tertiary,
            textAlign: term.isPattern ? "left" : "auto",
            writingDirection: term.isPattern ? "ltr" : "auto",
          },
        ]}
      >
        {term.term}
      </Text>
      <Text style={meta}>{details.join(" · ")}</Text>
      <View style={styles.row}>
        {term.draft && term.active ? (
          <ActionButton
            label={t("contentFilter.list.keep")}
            disabled={busy}
            onPress={() => void run(() => actions.setTermActive(term.id, true))}
            testID={`filter-term-keep-${term.id}`}
          />
        ) : null}
        <ActionButton
          label={
            term.active ? t("contentFilter.list.turnOff") : t("contentFilter.list.turnOn")
          }
          danger={term.active}
          disabled={busy}
          onPress={() => void run(() => actions.setTermActive(term.id, !term.active))}
          testID={`filter-term-toggle-${term.id}`}
        />
      </View>
      <ErrorLine text={errorText} />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  card: { borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 12 },
  line: { minHeight: 48, borderWidth: 1, borderRadius: 12 },
});
