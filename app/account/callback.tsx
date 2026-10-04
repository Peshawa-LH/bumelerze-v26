import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { completeEmailLink } from "@/features/account/service";
import { syncAccountNow } from "@/features/account/store";
import { useTheme } from "@/theme";

/**
 * Landing page of the emailed sign-in link. The Supabase client reads the
 * session out of the URL; this screen waits for it (up to ~8 s), then goes
 * to the profile form when the account has no profile yet, otherwise to My
 * account. An expired / already-used link (or none arriving) shows a short
 * message with a way back to sign-in.
 */
export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function finish() {
      let result;
      try {
        result = await completeEmailLink();
      } catch {
        result = { status: "expired" as const };
      }
      if (cancelled) {
        return;
      }
      if (result.status !== "ok") {
        setFailed(true);
        return;
      }
      await syncAccountNow().catch(() => undefined);
      if (cancelled) {
        return;
      }
      router.replace(result.hasProfile ? "/my-data" : "/account/profile");
    }
    void finish();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surface.base, padding: spacing[5], gap: spacing[4] }]}>
      <Stack.Screen
        options={{
          title: t("account.callback.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      {failed ? (
        <>
          <Text
            accessibilityRole="alert"
            style={{
              color: colors.text.primary,
              fontSize: typography.h3.fontSize,
              lineHeight: typography.h3.lineHeight,
              fontWeight: typography.h3.fontWeight,
            }}
          >
            {t("account.callback.expired")}
          </Text>
          <AccountButton
            tone="primary"
            label={t("account.callback.backToSignIn")}
            onPress={() => router.replace("/account/sign-in")}
            testID="callback-back"
          />
        </>
      ) : (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("account.callback.working")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
});
