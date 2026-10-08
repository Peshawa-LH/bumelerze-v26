import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { formatUsername } from "@/features/community/username";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { SupabaseAdminTransport, type AdminTransport } from "../transport";
import { generateTempPassword } from "../temp-password";
import type { FoundAccount } from "../types";

const COPIED_MS = 2000;
const MIN_QUERY = 3;

/**
 * "Reset a password" (permission `accounts.reset_password`, migration 0051).
 * Search by @username or exact email, pick the account, confirm; a temporary
 * password is made here, sent to the server and shown ONCE with a copy button
 * so the admin can pass it on. It lives only in this component's state: it is
 * not logged, cached or put in a query, and "Done" clears it.
 */
export function PasswordResetSection({
  transport = SupabaseAdminTransport,
}: {
  transport?: AdminTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function search() {
    setBusy(true);
    setErrorText(null);
    setIssued(null);
    try {
      setResults(await transport.findAccounts(query.trim()));
    } catch (error) {
      setResults(null);
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  async function reset(account: FoundAccount) {
    setBusy(true);
    setErrorText(null);
    const password = generateTempPassword();
    try {
      await transport.resetPassword(account.userId, password);
      setIssued({ name: nameOf(account), password });
      setCopied(false);
      setResults(null);
      setQuery("");
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  function nameOf(account: FoundAccount): string {
    return account.username
      ? formatUsername(account.username)
      : (account.displayName ?? account.maskedEmail ?? "");
  }

  function confirmReset(account: FoundAccount) {
    confirmDialog({
      title: t("admin.passwords.confirmTitle"),
      message: t("admin.passwords.confirmMessage", { name: nameOf(account) }),
      confirmLabel: t("admin.passwords.confirmButton"),
      cancelLabel: t("eventHub.thread.cancel"),
      destructive: true,
      onConfirm: () => void reset(account),
    });
  }

  async function copy() {
    if (!issued) return;
    try {
      await Clipboard.setStringAsync(issued.password);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard unavailable: the password is still selectable text.
    }
  }

  return (
    <View style={{ gap: spacing[3] }} testID="admin-passwords">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("admin.passwords.title")}
      </Text>
      <Text style={meta}>{t("admin.passwords.hint")}</Text>

      {issued ? (
        <View
          style={[
            styles.issued,
            {
              borderColor: colors.status.success,
              backgroundColor: colors.surface.raised,
              padding: spacing[4],
              gap: spacing[2],
            },
          ]}
          testID="admin-temp-password-card"
        >
          <Text
            style={[
              typography.bodyDefault,
              { color: colors.text.primary, fontWeight: "600" },
            ]}
          >
            {t("admin.passwords.resultTitle", { name: issued.name })}
          </Text>
          <View style={[styles.row, { gap: spacing[2] }]}>
            <Text
              selectable
              testID="admin-temp-password"
              style={[styles.password, { color: colors.text.primary }]}
            >
              {issued.password}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("admin.passwords.copy")}
              onPress={() => void copy()}
              style={styles.copy}
              testID="admin-temp-password-copy"
            >
              <Ionicons name="copy-outline" size={22} color={colors.text.secondary} />
            </Pressable>
            {copied ? (
              <Text
                accessibilityLiveRegion="polite"
                testID="admin-temp-password-copied"
                style={[meta, { color: colors.status.success }]}
              >
                {t("admin.passwords.copied")}
              </Text>
            ) : null}
          </View>
          <Text style={meta}>{t("admin.passwords.resultNote")}</Text>
          <AccountButton
            tone="primary"
            label={t("admin.passwords.done")}
            onPress={() => setIssued(null)}
            testID="admin-temp-password-done"
          />
        </View>
      ) : (
        <View style={{ gap: spacing[2] }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="username / email"
            placeholderTextColor={colors.text.tertiary}
            accessibilityLabel={t("admin.passwords.searchLabel")}
            returnKeyType="search"
            onSubmitEditing={() => query.trim().length >= MIN_QUERY && void search()}
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor: colors.border.default,
                backgroundColor: colors.surface.raised,
                fontSize: typography.bodyDefault.fontSize,
                paddingHorizontal: spacing[3],
              },
            ]}
            testID="admin-password-search-input"
          />
          <AccountButton
            label={t("admin.passwords.searchButton")}
            disabled={query.trim().length < MIN_QUERY || busy}
            onPress={() => void search()}
            testID="admin-password-search"
          />
        </View>
      )}

      {results !== null && results.length === 0 ? (
        <Text style={meta} testID="admin-password-none">
          {t("admin.passwords.noResults")}
        </Text>
      ) : null}
      {(results ?? []).map((account) => (
        <View
          key={account.userId}
          style={[styles.row, { gap: spacing[2], minHeight: 56 }]}
          testID={`admin-account-${account.userId}`}
        >
          <View style={styles.grow}>
            <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
              {account.displayName ?? t("eventHub.thread.anonymous")}
            </Text>
            <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
              {[
                account.username ? formatUsername(account.username) : null,
                account.maskedEmail,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <ActionButton
            label={t("admin.passwords.reset")}
            danger
            disabled={busy}
            onPress={() => confirmReset(account)}
            testID={`admin-reset-${account.userId}`}
          />
        </View>
      ))}
      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    writingDirection: "ltr",
    textAlign: "left",
  },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  grow: { flex: 1 },
  issued: { borderWidth: 1, borderRadius: 14 },
  password: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1,
    writingDirection: "ltr",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  copy: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
