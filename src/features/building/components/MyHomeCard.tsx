import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalChevron } from "@/components/DirectionalChevron";
import { useAccount } from "@/features/account/use-account";
import { withAlpha } from "@/features/badges/tones";
import { useTheme } from "@/theme";
import { MAX_HOMES_PER_ACCOUNT } from "../constants";
import { useMyHomes } from "../queries";
import { Heading } from "./ui";
import { Chip, HomeCard } from "./HomeCard";

const CIRCLE = 48;

/**
 * "My home" on the My account page.
 * - Anonymous: one muted preview row (lock, "Tag my building"); a preview of
 *   what an account unlocks, not a second sign-up button.
 * - Account without a tag: a card that starts tagging, and a "Join a home" link.
 * - Account with tags: one `HomeCard` each, "Tag another" and "Join a home".
 * Hidden while no Supabase project is configured or the session is loading.
 */
export function MyHomeCard() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const account = useAccount();
  const mine = useMyHomes();

  if (account.status === "unconfigured" || account.status === "loading") {
    return null;
  }

  const title = <Heading level={3}>{t("building.section.title")}</Heading>;

  if (account.status !== "account") {
    return (
      <View style={{ gap: spacing[2] }} testID="home-section">
        {title}
        <Pressable
          testID="home-section-sign-in"
          accessibilityRole="button"
          accessibilityLabel={t("building.title")}
          accessibilityHint={t("myData.home.needsAccount")}
          onPress={() => router.push("/account/sign-in")}
          style={({ pressed }) => [
            styles.card,
            styles.row,
            {
              padding: spacing[3],
              gap: spacing[3],
              backgroundColor: pressed ? colors.surface.sunken : colors.surface.raised,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View
            testID="home-locked"
            style={[styles.circle, { backgroundColor: colors.surface.sunken }]}
          >
            <Ionicons name="lock-closed" size={22} color={colors.text.secondary} />
          </View>
          <Text
            style={[
              typography.bodyDefault,
              styles.grow,
              { color: colors.text.secondary },
            ]}
          >
            {t("building.title")}
          </Text>
          <DirectionalChevron />
        </Pressable>
      </View>
    );
  }

  const homes = mine.data?.homes ?? [];
  const pending = mine.data?.pendingRequests ?? 0;
  const canTagMore =
    homes.filter((home) => home.role === "owner").length < MAX_HOMES_PER_ACCOUNT;
  const ready = !mine.isLoading && !mine.isError;

  const link = (testID: string, label: string, path: "/home/new" | "/home/join") => (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => router.push(path)}
      style={styles.link}
    >
      <Text style={[typography.labelButton, { color: colors.text.link }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: spacing[2] }} testID="home-section">
      {title}
      {mine.isLoading ? (
        <View
          testID="home-skeleton"
          style={[
            styles.card,
            styles.skeleton,
            {
              backgroundColor: colors.surface.sunken,
              borderColor: colors.border.default,
            },
          ]}
        />
      ) : null}
      {mine.isError ? (
        <View
          style={[
            styles.card,
            styles.row,
            {
              padding: spacing[3],
              gap: spacing[3],
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
            },
          ]}
        >
          <Text
            style={[typography.bodyDefault, styles.grow, { color: colors.text.primary }]}
          >
            {t("building.section.loadError")}
          </Text>
          <Pressable
            testID="home-retry"
            accessibilityRole="button"
            accessibilityLabel={t("building.section.retry")}
            onPress={() => void mine.refetch()}
            style={styles.link}
          >
            <Text style={[typography.labelButton, { color: colors.text.link }]}>
              {t("building.section.retry")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {homes.map((home) => (
        <HomeCard key={home.tag.tagId} home={home} />
      ))}
      {pending > 0 ? (
        <View style={styles.pending}>
          <Chip
            testID="home-pending"
            icon="hourglass-outline"
            text={t("building.section.pending")}
          />
        </View>
      ) : null}
      {ready && homes.length === 0 && canTagMore ? (
        <Pressable
          testID="home-tag"
          accessibilityRole="button"
          accessibilityLabel={t("building.title")}
          onPress={() => router.push("/home/new")}
          style={({ pressed }) => [
            styles.card,
            styles.row,
            {
              padding: spacing[3],
              gap: spacing[3],
              backgroundColor: pressed ? colors.surface.sunken : colors.surface.raised,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View
            style={[
              styles.circle,
              { backgroundColor: withAlpha(colors.brand.primary, 0.16) },
            ]}
          >
            <Ionicons name="home" size={24} color={colors.brand.primary} />
          </View>
          <Text
            style={[typography.bodyDefault, styles.grow, { color: colors.text.primary }]}
          >
            {t("building.title")}
          </Text>
          <DirectionalChevron />
        </Pressable>
      ) : null}
      {ready ? (
        <View style={[styles.links, { gap: spacing[4] }]}>
          {homes.length > 0 && canTagMore
            ? link("home-tag", t("building.section.tagAnother"), "/home/new")
            : null}
          {link("home-join", t("building.section.join"), "/home/join")}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
  row: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  skeleton: { height: 96 },
  link: { minHeight: 44, justifyContent: "center" },
  links: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  pending: { flexDirection: "row" },
});
