import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import {
  DISPLAY_NAME_MAX,
  PRIVACY_URL,
  PROFESSIONS,
  RESEARCH_CONSENT_VERSION,
  TERMS_VERSION,
  type Profession,
} from "../constants";
import { accountErrorText } from "../error-text";
import { getAvatarUrl, pickAvatar, saveProfile } from "../service";
import { refreshProfile } from "../store";
import type { AvatarChange, PrivateProfile, Profile } from "../types";
import { validateProfileForm } from "../validation";
import { AccountButton } from "./AccountButton";
import { Avatar } from "./Avatar";

interface ProfileFormProps {
  profile: Profile | null;
  privateProfile: PrivateProfile | null;
}

/** Create / edit profile. Name is required (2-40), photo and profession are
 * optional, profession is private. Terms consent is required; research use
 * is a separate optional checkbox. Initial values come from props, so the
 * parent mounts this only once the stored rows have loaded. */
export function ProfileForm({ profile, privateProfile }: ProfileFormProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();

  const [name, setName] = useState(profile?.displayName ?? "");
  const [profession, setProfession] = useState<Profession | null>(privateProfile?.profession ?? null);
  const [termsAccepted, setTermsAccepted] = useState(privateProfile?.termsVersion === TERMS_VERSION);
  const [researchConsent, setResearchConsent] = useState(
    privateProfile?.researchConsentVersion === RESEARCH_CONSENT_VERSION,
  );
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const validation = validateProfileForm({ displayName: name, termsAccepted });
  const nameTouchedInvalid = name.length > 0 && !validation.nameValid;

  const avatarUri =
    avatar.kind === "new"
      ? avatar.uri
      : avatar.kind === "remove"
        ? null
        : getAvatarUrl(profile?.avatarPath);
  const hasPhoto = avatarUri !== null;

  async function handlePickPhoto() {
    setErrorText(null);
    try {
      const uri = await pickAvatar();
      if (uri) {
        setAvatar({ kind: "new", uri });
      }
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    }
  }

  async function handleSave() {
    if (!validation.valid || saving) {
      return;
    }
    setSaving(true);
    setErrorText(null);
    try {
      await saveProfile({
        displayName: name,
        profession,
        termsAccepted,
        researchConsent,
        avatar,
        locale: i18n.language,
        previous: { profile, privateProfile },
      });
      await refreshProfile();
      router.back();
    } catch (error) {
      setErrorText(accountErrorText(t, error));
    } finally {
      setSaving(false);
    }
  }

  const label = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    fontWeight: "600" as const,
  };
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  };

  return (
    <View style={{ gap: spacing[4] }}>
      <View style={{ gap: spacing[2] }}>
        <Text style={label}>{t("account.profile.nameLabel")}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={DISPLAY_NAME_MAX}
          accessibilityLabel={t("account.profile.nameLabel")}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: nameTouchedInvalid ? colors.status.danger : colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              paddingHorizontal: spacing[3],
              // Names follow the writing direction of what is typed.
              textAlign: "auto",
            },
          ]}
          testID="profile-name-input"
        />
        <Text
          style={[meta, nameTouchedInvalid ? { color: colors.status.danger } : null]}
          accessibilityLiveRegion="polite"
        >
          {t("account.profile.nameHint")}
        </Text>
      </View>

      <View style={{ gap: spacing[2] }}>
        <Text style={label}>{t("account.profile.photoLabel")}</Text>
        <View style={[styles.photoRow, { gap: spacing[3] }]}>
          <Avatar uri={avatarUri} name={name} size={72} />
          <View style={{ flex: 1, gap: spacing[2] }}>
            <AccountButton
              label={hasPhoto ? t("account.profile.photoChange") : t("account.profile.photoChoose")}
              onPress={() => void handlePickPhoto()}
              testID="profile-photo-choose"
            />
            {hasPhoto ? (
              <AccountButton
                tone="destructive"
                label={t("account.profile.photoRemove")}
                onPress={() => setAvatar({ kind: "remove" })}
                testID="profile-photo-remove"
              />
            ) : null}
          </View>
        </View>
      </View>

      <View style={{ gap: spacing[2] }} accessibilityRole="radiogroup">
        <Text style={label}>{t("account.profile.professionLabel")}</Text>
        <Text style={meta}>{t("account.profile.professionHint")}</Text>
        <View style={[styles.chips, { gap: spacing[2] }]}>
          <Chip
            text={t("account.profile.preferNot")}
            selected={profession === null}
            onPress={() => setProfession(null)}
            testID="profession-none"
          />
          {PROFESSIONS.map((value) => (
            <Chip
              key={value}
              text={t(`account.professions.${value}`)}
              selected={profession === value}
              onPress={() => setProfession(value)}
              testID={`profession-${value}`}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing[3] }}>
        <Checkbox
          checked={termsAccepted}
          onToggle={() => setTermsAccepted((value) => !value)}
          text={t("account.profile.terms")}
          testID="profile-terms"
        />
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)}
          style={styles.linkRow}
          testID="profile-privacy-link"
        >
          <Text style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}>
            {t("account.profile.privacyLink")}
          </Text>
        </Pressable>
        <Checkbox
          checked={researchConsent}
          onToggle={() => setResearchConsent((value) => !value)}
          text={t("account.profile.research")}
          testID="profile-research"
        />
      </View>

      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.status.danger,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {errorText}
        </Text>
      ) : null}

      <AccountButton
        tone="primary"
        label={saving ? t("account.profile.saving") : t("account.profile.save")}
        disabled={!validation.valid || saving}
        onPress={() => void handleSave()}
        testID="profile-save"
      />
    </View>
  );
}

function Chip({
  text,
  selected,
  onPress,
  testID,
}: {
  text: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      testID={testID}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.brand.primary : colors.border.default,
          backgroundColor: selected ? colors.brand.primary : colors.surface.raised,
          paddingHorizontal: spacing[3],
        },
      ]}
    >
      <Text
        style={{
          color: selected ? colors.brand.onPrimary : colors.text.primary,
          fontSize: typography.bodyMeta.fontSize,
          fontWeight: "600",
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

function Checkbox({
  checked,
  onToggle,
  text,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  text: string;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={text}
      onPress={onToggle}
      testID={testID}
      style={[styles.checkboxRow, { gap: spacing[3] }]}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: checked ? colors.brand.primary : colors.border.default,
            backgroundColor: checked ? colors.brand.primary : colors.surface.raised,
          },
        ]}
      >
        {checked ? (
          <Text style={{ color: colors.brand.onPrimary, fontSize: 16, fontWeight: "700" }}>{"✓"}</Text>
        ) : null}
      </View>
      <Text
        style={{
          flex: 1,
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 52,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chip: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 44,
  },
  box: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  linkRow: {
    minHeight: 44,
    justifyContent: "center",
  },
});
