import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { withAlpha } from "@/features/badges/tones";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  USING_APP_EXAMPLE_HUB_ID,
  USING_APP_EXAMPLE_KEY,
  USING_APP_GUIDES,
  USING_APP_OPEN_ACCOUNT_KEY,
  USING_APP_TITLE_KEY,
  usingAppGuideTitleKey,
  usingAppLabelParamKeys,
  usingAppStepKeys,
  type UsingAppActionId,
  type UsingAppGuide,
} from "../using-app";

/**
 * "Using Bumelerze": four collapsed rows under the Prepare guides. Collapsed
 * by default so the section adds almost nothing to the page (owner: "keep text
 * less"); a tap opens a few numbered steps and, where it helps, a button that
 * goes straight to the feature. Same card look as `SafetyCard`; rows and steps
 * use `flexDirection: "row"` only, so everything mirrors under RTL.
 */
export function UsingAppSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View testID="using-app" style={{ gap: spacing[3], marginTop: spacing[4] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
        }}
      >
        {t(USING_APP_TITLE_KEY)}
      </Text>
      {USING_APP_GUIDES.map((guide) => (
        <UsingAppGuideCard key={guide.id} guide={guide} />
      ))}
    </View>
  );
}

interface ResolvedAction {
  id: UsingAppActionId;
  tone: "primary" | "secondary";
  label: string;
  /** Spoken after the label (anonymous "Tag my building" needs an account). */
  hint: string | undefined;
  onPress: () => void;
}

function UsingAppGuideCard({ guide }: { guide: UsingAppGuide }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const account = useAccount();
  const [expanded, setExpanded] = useState(false);

  // Names of buttons/screens mentioned in the steps, resolved from the keys the
  // app already uses for them.
  const params: Record<string, string> = {};
  for (const [name, key] of Object.entries(usingAppLabelParamKeys(guide.id))) {
    params[name] = t(key);
  }
  const title = t(usingAppGuideTitleKey(guide));
  const hasHub = account.status !== "unconfigured";

  const actions = guide.actions.flatMap((action): ResolvedAction[] => {
    if (action === "tagBuilding") {
      if (!hasHub) return [];
      const signedIn = account.status === "account";
      return [
        {
          id: action,
          tone: "primary",
          label: t("building.title"),
          hint:
            signedIn || account.status === "loading"
              ? undefined
              : t("myData.home.needsAccount"),
          // Anonymous installs sign in first (as the My home card does); the
          // tagging screen itself gates on an account too.
          onPress: () =>
            router.push(
              signedIn || account.status === "loading" ? "/home/new" : "/account/sign-in",
            ),
        },
      ];
    }
    if (action === "openAccount") {
      return [
        {
          id: action,
          tone: "primary",
          label: t(USING_APP_OPEN_ACCOUNT_KEY, { account: t("myData.title") }),
          hint: undefined,
          onPress: () => router.push("/my-data"),
        },
      ];
    }
    if (!hasHub) return [];
    return [
      {
        id: action,
        tone: "secondary",
        label: t(USING_APP_EXAMPLE_KEY),
        hint: undefined,
        onPress: () => router.push(`/event-hub/${USING_APP_EXAMPLE_HUB_ID}`),
      },
    ];
  });

  return (
    <View
      testID={`using-app-${guide.id}`}
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      <Pressable
        testID={`using-app-${guide.id}-toggle`}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={[styles.header, { padding: spacing[3], gap: spacing[3] }]}
      >
        <View
          style={[
            styles.circle,
            { backgroundColor: withAlpha(colors.brand.primary, 0.16) },
          ]}
        >
          <Ionicons name={guide.icon} size={24} color={colors.brand.primary} />
        </View>
        <Text
          style={{
            flex: 1,
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {title}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={colors.text.tertiary}
        />
      </Pressable>

      {expanded ? (
        <View style={{ gap: spacing[3], padding: spacing[3], paddingTop: 0 }}>
          {usingAppStepKeys(guide).map((stepKey, index) => (
            <View key={stepKey} style={[styles.step, { gap: spacing[3] }]}>
              <View
                style={[styles.number, { backgroundColor: colors.surface.sunken }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text
                  style={{
                    color: colors.text.secondary,
                    fontSize: typography.bodyMeta.fontSize,
                    fontWeight: "700",
                  }}
                >
                  {localizeDigits(String(index + 1), i18n.language)}
                </Text>
              </View>
              <Text
                testID={`using-app-${guide.id}-step`}
                style={{
                  flex: 1,
                  color: colors.text.secondary,
                  fontSize: typography.bodyDefault.fontSize,
                  lineHeight: typography.bodyDefault.lineHeight,
                }}
              >
                {t(stepKey, params)}
              </Text>
            </View>
          ))}
          {actions.map((action) => (
            <AccountButton
              key={action.id}
              testID={`using-app-action-${action.id}`}
              tone={action.tone}
              label={action.label}
              {...(action.hint
                ? { accessibilityLabel: `${action.label}. ${action.hint}` }
                : {})}
              onPress={action.onPress}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", minHeight: 56 },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  step: { flexDirection: "row", alignItems: "flex-start" },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
