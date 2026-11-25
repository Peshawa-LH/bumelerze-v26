import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import {
  formatAbsoluteDual,
  formatDateOnly,
  formatMagnitudeValue,
  isolateLocalizedTime,
  isolateNumeric,
} from "@/features/events/format";
import {
  NOTICE_LANGUAGES,
  type NoticeKind,
  type NoticeLanguage,
  type NoticeTexts,
} from "@/features/home-extras/transport";
import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";
import { Sheet } from "../people/components/Sheet";
import { useAdminAccess } from "../queries";
import { ChoiceChips, ToolCard, ToolPage, ToolSectionTitle, useTextDir } from "../ui";
import { useAdminHomeActions, useAdminHomeFind, useAdminHomeState } from "./queries";
import {
  MAX_PINS,
  NOTICE_HOURS,
  NOTICE_MAX_LENGTH,
  PIN_DAYS,
  type AdminHomeEvent,
  type HomeAdminTransport,
  type NoticeHours,
  type PinDays,
} from "./transport";

/** The words for the errors only this tool can meet; the rest are shared. */
export function homeErrorText(t: TFunction, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("home_notice_empty")) {
    return t("admin.home.errors.empty");
  }
  if (message.includes("home_notice_too_long")) {
    return t("admin.home.errors.tooLong");
  }
  if (message.includes("too_many")) {
    return t("admin.home.errors.tooMany");
  }
  return communityErrorText(t, error);
}

function useUntil() {
  const { t, i18n } = useTranslation();
  return (endsAt: number) =>
    t("admin.home.until", {
      time: isolateLocalizedTime(formatAbsoluteDual(endsAt, i18n.language, t).local),
    });
}

/** "M 5.1 · Near Ranya · 1 Oct 2026 · bml2026x01", as in Open a hub. */
function useEventLine() {
  const { t, i18n } = useTranslation();
  return (event: AdminHomeEvent) =>
    [
      event.magnitude !== null
        ? t("admin.hubs.magnitude", {
            value: isolateNumeric(formatMagnitudeValue(event.magnitude, i18n.language)),
          })
        : null,
      event.place,
      formatDateOnly(event.originTime, i18n.language, t),
      event.bumelerzeId ? isolateNumeric(event.bumelerzeId) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

/**
 * Admin > Home screen (B2.6 stage 1, migration 0084): the message at the top
 * of Home and up to three earthquakes chosen for it. Admins only (owner
 * choice 1, `home.manage`). Everything ends by itself at the chosen time;
 * phones pick a change up within about 2 minutes. Every change goes to the
 * activity log.
 */
export function HomeScreenContent({
  transport,
  hubTransport,
}: {
  transport?: HomeAdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const access = useAdminAccess(hubTransport);
  const allowed = access.has("home.manage");
  const state = useAdminHomeState(allowed, transport);
  const actions = useAdminHomeActions(transport);
  const snackbar = useSnackbar();
  const until = useUntil();
  const eventLine = useEventLine();

  const [texts, setTexts] = useState<Record<NoticeLanguage, string>>({
    en: "",
    ckb: "",
    kmr: "",
    ar: "",
  });
  const [kind, setKind] = useState<NoticeKind>("info");
  const [hours, setHours] = useState<NoticeHours>(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pinFor, setPinFor] = useState<AdminHomeEvent | null>(null);
  const found = useAdminHomeFind(query, allowed, transport);

  // Search as the person types, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  const alert = [typography.bodyMeta, dir, { color: colors.status.danger }];

  if (!allowed) {
    return access.isLoading ? null : (
      <ToolPage testID="home-admin-page">
        <Text style={meta} testID="home-admin-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </ToolPage>
    );
  }

  const notice = state.data?.notice ?? null;
  const pins = state.data?.pins ?? [];
  const full = pins.length >= MAX_PINS;

  async function post() {
    const filled: NoticeTexts = {};
    for (const language of NOTICE_LANGUAGES) {
      const value = texts[language].trim();
      if (value !== "") {
        filled[language] = value;
      }
    }
    if (Object.keys(filled).length === 0) {
      setNoticeError(t("admin.home.errors.empty"));
      return;
    }
    if (Object.values(filled).some((value) => value.length > NOTICE_MAX_LENGTH)) {
      setNoticeError(t("admin.home.errors.tooLong"));
      return;
    }
    setBusy("post");
    setNoticeError(null);
    try {
      await actions.postNotice({ kind, texts: filled, hours });
      setTexts({ en: "", ckb: "", kmr: "", ar: "" });
      snackbar.show({ message: t("admin.home.posted") });
    } catch (error) {
      setNoticeError(homeErrorText(t, error));
    } finally {
      setBusy(null);
    }
  }

  async function removeNotice() {
    setBusy("remove");
    setNoticeError(null);
    try {
      await actions.removeNotice();
      snackbar.show({ message: t("admin.home.removed") });
    } catch (error) {
      setNoticeError(homeErrorText(t, error));
    } finally {
      setBusy(null);
    }
  }

  async function unpin(event: AdminHomeEvent) {
    setBusy(event.eventId);
    setPinError(null);
    try {
      await actions.unpin(event.eventId);
      snackbar.show({ message: t("admin.home.unpinned") });
    } catch (error) {
      setPinError(homeErrorText(t, error));
    } finally {
      setBusy(null);
    }
  }

  const input = {
    ...typography.bodyDefault,
    color: colors.text.primary,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
    paddingHorizontal: spacing[3],
  };

  return (
    <ToolPage testID="home-admin-page" hint={t("admin.home.hint")}>
      <ToolSectionTitle
        title={t("admin.home.messageTitle")}
        testID="home-admin-message-title"
      />
      <Text style={meta}>{t("admin.home.messageHint")}</Text>
      {notice ? (
        <ToolCard
          testID="home-admin-notice"
          title={t(
            notice.kind === "important"
              ? "admin.home.kinds.important"
              : "admin.home.kinds.info",
          )}
          subtitle={until(notice.endsAt)}
        >
          {NOTICE_LANGUAGES.filter((language) => notice.texts[language]).map(
            (language) => (
              <Text
                key={language}
                testID={`home-admin-notice-${language}`}
                style={[
                  typography.bodyDefault,
                  {
                    color: colors.text.primary,
                    writingDirection: isRTLLocale(language) ? "rtl" : "ltr",
                  },
                ]}
              >
                {notice.texts[language]}
              </Text>
            ),
          )}
          <ActionButton
            label={t("admin.home.remove")}
            disabled={busy !== null}
            onPress={() => void removeNotice()}
            testID="home-admin-notice-remove"
          />
        </ToolCard>
      ) : null}
      <ToolCard testID="home-admin-form">
        {NOTICE_LANGUAGES.map((language) => (
          <View key={language} style={{ gap: spacing[1] }}>
            <Text style={meta}>{t(`settings.languageNative.${language}`)}</Text>
            <TextInput
              value={texts[language]}
              onChangeText={(value) => setTexts((old) => ({ ...old, [language]: value }))}
              multiline
              maxLength={NOTICE_MAX_LENGTH}
              placeholder={t("admin.home.placeholder")}
              placeholderTextColor={colors.text.tertiary}
              accessibilityLabel={`${t("admin.home.messageTitle")}: ${t(`settings.languageNative.${language}`)}`}
              style={[
                styles.text,
                input,
                {
                  paddingVertical: spacing[2],
                  writingDirection: isRTLLocale(language) ? "rtl" : "ltr",
                  textAlign: "auto",
                },
              ]}
              testID={`home-admin-text-${language}`}
            />
          </View>
        ))}
        <Text style={meta}>{t("admin.home.kindLabel")}</Text>
        <ChoiceChips
          label={t("admin.home.kindLabel")}
          options={[
            { value: "info", label: t("admin.home.kinds.info") },
            { value: "important", label: t("admin.home.kinds.important") },
          ]}
          value={kind}
          onChange={setKind}
          testID="home-admin-kind"
        />
        <Text style={meta}>{t("admin.home.showForLabel")}</Text>
        <ChoiceChips
          label={t("admin.home.showForLabel")}
          options={NOTICE_HOURS.map((value) => ({
            value,
            label: t(`admin.home.hours.${value}`),
          }))}
          value={hours}
          onChange={setHours}
          testID="home-admin-hours"
        />
        {notice ? (
          <Text style={meta} testID="home-admin-replaces">
            {t("admin.home.replaces")}
          </Text>
        ) : null}
        <AccountButton
          label={t("admin.home.post")}
          tone="primary"
          disabled={busy !== null}
          onPress={() => void post()}
          testID="home-admin-post"
        />
        {noticeError ? (
          <Text accessibilityRole="alert" style={alert} testID="home-admin-notice-error">
            {noticeError}
          </Text>
        ) : null}
      </ToolCard>

      <ToolSectionTitle
        title={t("admin.home.pinsTitle")}
        testID="home-admin-pins-title"
      />
      <Text style={meta}>{t("admin.home.pinsHint")}</Text>
      {state.data && pins.length === 0 ? (
        <Text style={meta} testID="home-admin-pins-empty">
          {t("admin.home.pinsEmpty")}
        </Text>
      ) : null}
      {pins.map((event) => (
        <ToolCard key={event.eventId} testID={`home-admin-pin-${event.eventId}`}>
          <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
            {eventLine(event)}
          </Text>
          {event.onHomeUntil !== null ? (
            <Text style={meta}>{until(event.onHomeUntil)}</Text>
          ) : null}
          <ActionButton
            label={t("admin.home.unpin")}
            disabled={busy !== null}
            onPress={() => void unpin(event)}
            testID={`home-admin-unpin-${event.eventId}`}
          />
        </ToolCard>
      ))}
      {pinError ? (
        <Text accessibilityRole="alert" style={alert} testID="home-admin-pin-error">
          {pinError}
        </Text>
      ) : null}

      <ToolSectionTitle title={t("admin.hubs.findTitle")} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t("admin.hubs.searchPlaceholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.hubs.searchLabel")}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.search, input, { textAlign: "auto" }]}
        testID="home-admin-search"
      />
      {full ? (
        <Text style={meta} testID="home-admin-full">
          {t("admin.home.errors.tooMany")}
        </Text>
      ) : null}
      {found.isLoading ? (
        <Text style={meta}>{t("eventDetail.loading")}</Text>
      ) : found.isError ? (
        <Text accessibilityRole="alert" style={alert} testID="home-admin-find-error">
          {communityErrorText(t, found.error)}
        </Text>
      ) : found.data && found.data.length === 0 ? (
        <Text style={meta} testID="home-admin-found-empty">
          {query.trim() === "" ? t("admin.hubs.recentEmpty") : t("admin.hubs.noMatch")}
        </Text>
      ) : null}
      {found.data?.map((event) => (
        <ToolCard key={event.eventId} testID={`home-admin-found-${event.eventId}`}>
          <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
            {eventLine(event)}
          </Text>
          {event.onHomeUntil !== null ? (
            <Text style={meta}>{until(event.onHomeUntil)}</Text>
          ) : (
            <AccountButton
              label={t("admin.home.pin")}
              tone="primary"
              disabled={busy !== null || full}
              onPress={() => setPinFor(event)}
              testID={`home-admin-pin-open-${event.eventId}`}
            />
          )}
        </ToolCard>
      ))}
      {pinFor ? (
        <PinSheet
          event={pinFor}
          line={eventLine(pinFor)}
          onClose={() => setPinFor(null)}
          onPin={(days) => actions.pin(pinFor.eventId, days)}
        />
      ) : null}
    </ToolPage>
  );
}

function PinSheet({
  event,
  line,
  onClose,
  onPin,
}: {
  event: AdminHomeEvent;
  line: string;
  onClose: () => void;
  onPin: (days: PinDays) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const snackbar = useSnackbar();
  const [days, setDays] = useState<PinDays>(3);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = [typography.bodyMeta, { color: colors.text.secondary }];

  async function pin() {
    setBusy(true);
    setErrorText(null);
    try {
      await onPin(days);
      snackbar.show({ message: t("admin.home.pinned") });
      onClose();
    } catch (error) {
      setErrorText(homeErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("admin.home.pin")}
      subtitle={line}
      onClose={onClose}
      testID={`home-admin-pin-sheet-${event.eventId}`}
    >
      <Text style={meta}>{t("admin.home.showForLabel")}</Text>
      <ChoiceChips
        label={t("admin.home.showForLabel")}
        options={PIN_DAYS.map((value) => ({
          value,
          label: t(`admin.home.days.${value}`),
        }))}
        value={days}
        onChange={setDays}
        testID="home-admin-pin-days"
      />
      <AccountButton
        label={t("admin.home.pin")}
        tone="primary"
        disabled={busy}
        onPress={() => void pin()}
        testID="home-admin-pin-confirm"
      />
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="home-admin-pin-sheet-error"
        >
          {errorText}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  text: { minHeight: 72, borderWidth: 1, borderRadius: 10, textAlignVertical: "top" },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
});
