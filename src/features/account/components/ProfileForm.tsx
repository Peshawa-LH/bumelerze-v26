import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SupabaseCommunityTransport } from "@/features/community/transport";
import { GuidelinesSheet } from "@/features/guidelines/components/GuidelinesSheet";
import {
  formatUsername,
  isValidUsername,
  normalizeUsername,
  suggestUsername,
} from "@/features/community/username";
import { USERNAME_MAX } from "@/features/community/constants";
import { formatDateOnly, isolateNumeric } from "@/features/events/format";
import { PlaceSearch } from "@/features/geo/components/PlaceSearch";
import { placeDisplayName, type Place } from "@/features/geo/place-search";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  BIO_MAX_LENGTH,
  normalizeBio,
  validateBio,
  type CityLabel,
  type ProfileAbout,
} from "../about";
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
  /** Bio, city and the name-change allowance (migration 0058). `undefined`
   * when the server does not have them yet: the fields are then hidden.
   * `null` when ready but there is no profile yet (a new account). */
  about?: ProfileAbout | null | undefined;
  /** Clock for "can change again on" (tests). */
  nowMs?: number;
  /** After a successful save, before closing (the screen refreshes caches). */
  onSaved?: () => void;
}

/** Create / edit profile. Name is required (2-40), photo and profession are
 * optional, profession is private. Terms consent is required; research use
 * is a separate optional checkbox. Initial values come from props, so the
 * parent mounts this only once the stored rows have loaded. */
export function ProfileForm({
  profile,
  privateProfile,
  about,
  nowMs,
  onSaved,
}: ProfileFormProps) {
  const { t, i18n } = useTranslation();
  // "Can change again on" is compared with the time the form opened.
  const [openedAt] = useState(() => Date.now());
  const now = nowMs ?? openedAt;
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const locale = i18n.language;
  const aboutReady = about !== undefined;
  const [bio, setBio] = useState(about?.bio ?? "");
  const [city, setCity] = useState<CityLabel | null>(about?.city ?? null);
  const [pickingCity, setPickingCity] = useState(false);
  const bioProblem = aboutReady ? validateBio(bio) : null;
  // Name-change limits (0058): the server enforces them; this only says so
  // before anyone types a name that cannot be saved.
  const usernameLockedUntil =
    profile?.username && about?.usernameNextChangeAt && about.usernameNextChangeAt > now
      ? about.usernameNextChangeAt
      : null;
  const nameChangesLeft = about ? about.displayNameChangesLeft : null;
  const nameLockedUntil =
    nameChangesLeft === 0 && about?.displayNameNextChangeAt
      ? about.displayNameNextChangeAt
      : null;

  const [name, setName] = useState(profile?.displayName ?? "");
  const [profession, setProfession] = useState<Profession | null>(
    privateProfile?.profession ?? null,
  );
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(
    privateProfile?.termsVersion === TERMS_VERSION,
  );
  const [researchConsent, setResearchConsent] = useState(
    privateProfile?.researchConsentVersion === RESEARCH_CONSENT_VERSION,
  );
  const communityReady = profile?.communityReady !== false;
  const [username, setUsername] = useState(profile?.username ?? "");
  const [isPrivate, setIsPrivate] = useState(profile?.isPrivate ?? false);
  const [showBadges, setShowBadges] = useState(!(privateProfile?.hideBadges ?? false));
  const [checked, setChecked] = useState<{ name: string; free: boolean } | null>(null);
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const validation = validateProfileForm({ displayName: name, termsAccepted, username });
  const nameTouchedInvalid = name.length > 0 && !validation.nameValid;
  const typedUsername = normalizeUsername(username);
  const usernameChanged =
    typedUsername !== "" && typedUsername !== (profile?.username ?? "");
  const usernameTouchedInvalid = username.trim().length > 0 && !validation.usernameValid;
  const suggestion = useMemo(
    () => (validation.nameValid ? suggestUsername(name) : null),
    [name, validation.nameValid],
  );

  // Ask the server whether the name is free, a moment after typing stops.
  // A failed check just shows nothing: saving still enforces uniqueness.
  const shouldCheck = communityReady && usernameChanged && isValidUsername(typedUsername);
  useEffect(() => {
    if (!shouldCheck) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      SupabaseCommunityTransport.isUsernameAvailable(typedUsername)
        .then((free) => {
          if (!cancelled) setChecked({ name: typedUsername, free });
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shouldCheck, typedUsername]);
  const usernameState: "idle" | "checking" | "available" | "taken" = !shouldCheck
    ? "idle"
    : checked?.name === typedUsername
      ? checked.free
        ? "available"
        : "taken"
      : "checking";

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
    if (!validation.valid || saving || bioProblem !== null) {
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
        ...(communityReady
          ? { username: typedUsername, isPrivate, hideBadges: !showBadges }
          : {}),
        locale: i18n.language,
        ...(aboutReady ? { about: { bio, city } } : {}),
        previous: { profile, privateProfile, about: about ?? null },
      });
      await refreshProfile();
      onSaved?.();
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
          editable={nameLockedUntil === null}
          accessibilityLabel={t("account.profile.nameLabel")}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          style={[
            styles.input,
            {
              color: colors.text.primary,
              borderColor: nameTouchedInvalid
                ? colors.status.danger
                : colors.border.default,
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
        {nameLockedUntil !== null ? (
          <Text style={meta} testID="profile-name-limit">
            {t("account.profile.nameLocked", {
              date: formatDateOnly(nameLockedUntil, locale, t),
            })}
          </Text>
        ) : nameChangesLeft !== null && nameChangesLeft <= 2 ? (
          <Text style={meta} testID="profile-name-limit">
            {t("account.profile.nameChangesLeft", {
              count: nameChangesLeft,
              number: localizeDigits(String(nameChangesLeft), locale),
            })}
          </Text>
        ) : null}
      </View>

      {communityReady ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={label}>{t("account.profile.usernameLabel")}</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            maxLength={USERNAME_MAX + 1}
            editable={usernameLockedUntil === null}
            accessibilityLabel={t("account.profile.usernameLabel")}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            placeholder="username"
            placeholderTextColor={colors.text.tertiary}
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor:
                  usernameTouchedInvalid || usernameState === "taken"
                    ? colors.status.danger
                    : colors.border.default,
                backgroundColor: colors.surface.raised,
                fontSize: typography.bodyDefault.fontSize,
                paddingHorizontal: spacing[3],
                // Handles are always Latin: left to right in every language.
                writingDirection: "ltr",
                textAlign: "left",
              },
            ]}
            testID="profile-username-input"
          />
          <Text
            style={[
              meta,
              usernameTouchedInvalid || usernameState === "taken"
                ? { color: colors.status.danger }
                : null,
            ]}
            accessibilityLiveRegion="polite"
            testID="profile-username-status"
          >
            {usernameTouchedInvalid
              ? t("account.errors.username_invalid")
              : usernameState === "taken"
                ? t("account.errors.username_taken")
                : usernameState === "checking"
                  ? t("account.profile.usernameChecking")
                  : usernameState === "available"
                    ? t("account.profile.usernameAvailable")
                    : t("account.profile.usernameHint")}
          </Text>
          {usernameLockedUntil !== null ? (
            <Text style={meta} testID="profile-username-limit">
              {t("account.profile.usernameLocked", {
                date: formatDateOnly(usernameLockedUntil, locale, t),
              })}
            </Text>
          ) : profile?.username && aboutReady ? (
            <Text style={meta} testID="profile-username-limit">
              {t("account.profile.usernameOncePerMonth")}
            </Text>
          ) : null}
          {username.trim() === "" && suggestion ? (
            <Chip
              text={t("account.profile.usernameSuggest", {
                name: formatUsername(suggestion),
              })}
              selected={false}
              onPress={() => setUsername(suggestion)}
              testID="profile-username-suggest"
            />
          ) : null}
        </View>
      ) : null}

      {aboutReady ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={label}>{t("account.profile.bioLabel")}</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            multiline
            maxLength={BIO_MAX_LENGTH + 40}
            accessibilityLabel={t("account.profile.bioLabel")}
            placeholder={t("account.profile.bioPlaceholder")}
            placeholderTextColor={colors.text.tertiary}
            textAlignVertical="top"
            style={[
              styles.input,
              styles.bio,
              {
                color: colors.text.primary,
                borderColor: bioProblem ? colors.status.danger : colors.border.default,
                backgroundColor: colors.surface.raised,
                fontSize: typography.bodyDefault.fontSize,
                padding: spacing[3],
                textAlign: "auto",
              },
            ]}
            testID="profile-bio-input"
          />
          <Text
            style={[meta, bioProblem ? { color: colors.status.danger } : null]}
            accessibilityLiveRegion="polite"
            testID="profile-bio-status"
          >
            {bioProblem
              ? t(`account.errors.${bioProblem}`)
              : `${t("account.profile.bioHint")} ${isolateNumeric(
                  `${localizeDigits(String(normalizeBio(bio).length), locale)}/${localizeDigits(
                    String(BIO_MAX_LENGTH),
                    locale,
                  )}`,
                )}`}
          </Text>
        </View>
      ) : null}

      {aboutReady ? (
        <View style={{ gap: spacing[2] }}>
          <Text style={label}>{t("account.profile.cityLabel")}</Text>
          <Text style={meta}>{t("account.profile.cityHint")}</Text>
          {city ? (
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
              }}
              testID="profile-city-value"
            >
              {t("community.profile.livesIn", { place: city.name })}
            </Text>
          ) : null}
          <View style={[styles.chips, { gap: spacing[2] }]}>
            <Chip
              text={
                city ? t("account.profile.cityChange") : t("account.profile.cityChoose")
              }
              selected={false}
              onPress={() => setPickingCity((value) => !value)}
              testID="profile-city-choose"
            />
            {city ? (
              <Chip
                text={t("account.profile.cityRemove")}
                selected={false}
                onPress={() => {
                  setCity(null);
                  setPickingCity(false);
                }}
                testID="profile-city-remove"
              />
            ) : null}
          </View>
          {pickingCity ? (
            <PlaceSearch
              testID="profile-city-search"
              selectedPlaceId={city?.placeId ?? null}
              onSelect={(place: Place) => {
                // Only the id and the name are kept: never the coordinates.
                setCity({ placeId: place.id, name: placeDisplayName(place, locale) });
                setPickingCity(false);
              }}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: spacing[2] }}>
        <Text style={label}>{t("account.profile.photoLabel")}</Text>
        <View style={[styles.photoRow, { gap: spacing[3] }]}>
          <Avatar uri={avatarUri} name={name} size={72} />
          <View style={{ flex: 1, gap: spacing[2] }}>
            <AccountButton
              label={
                hasPhoto
                  ? t("account.profile.photoChange")
                  : t("account.profile.photoChoose")
              }
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

      {communityReady ? (
        <View style={{ gap: spacing[2] }}>
          <Checkbox
            checked={isPrivate}
            onToggle={() => setIsPrivate((value) => !value)}
            text={t("account.profile.privateLabel")}
            testID="profile-private"
          />
          <Text style={meta}>{t("account.profile.privateHint")}</Text>
          <Checkbox
            checked={showBadges}
            onToggle={() => setShowBadges((value) => !value)}
            text={t("account.profile.showBadgesLabel")}
            testID="profile-show-badges"
          />
        </View>
      ) : null}

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
          <Text
            style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}
          >
            {t("account.profile.privacyLink")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => setShowGuidelines(true)}
          style={styles.linkRow}
          testID="profile-guidelines-link"
        >
          <Text
            style={{ color: colors.text.link, fontSize: typography.bodyMeta.fontSize }}
          >
            {t("account.profile.guidelinesLink")}
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
        disabled={
          !validation.valid || saving || usernameState === "taken" || bioProblem !== null
        }
        onPress={() => void handleSave()}
        testID="profile-save"
      />

      {showGuidelines ? (
        <GuidelinesSheet
          mode="read"
          onClose={() => setShowGuidelines(false)}
          testID="profile-guidelines"
        />
      ) : null}
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
          <Text
            style={{ color: colors.brand.onPrimary, fontSize: 16, fontWeight: "700" }}
          >
            {"✓"}
          </Text>
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
  bio: { minHeight: 88 },
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
