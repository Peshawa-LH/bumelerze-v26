import Constants from "expo-constants";

/**
 * The app's version and web build id, read in one place (D90).
 *
 * - `appVersion()`: `version` from app.config.ts (year.release.fix).
 * - `appBuildId()`: the commit a hosted web build was made from, shortened to
 *   7 characters. scripts/build-app-web.sh sets `EXPO_PUBLIC_BUILD_ID` to the
 *   commit SHA; development, native and "local" builds have no usable id and
 *   get null.
 * - `appVersionStamp()`: "26.3.0+abc1234", or just "26.3.0" without a build
 *   id. Stamped on feedback, presence and sensor exports so two web builds of
 *   the same version can be told apart. Presence accepts at most 32 characters
 *   of `[0-9A-Za-z._+-]` (migration 0055), which this always fits.
 */

const BUILD_ID_PATTERN = /^[0-9a-f]{7,40}$/;
const SHORT_BUILD_ID_LENGTH = 7;

export function appVersion(): string | null {
  const version = Constants.expoConfig?.version;
  return typeof version === "string" && version.length > 0 ? version : null;
}

/** A commit SHA (7 to 40 lowercase hex characters) shortened to 7; anything else is null. */
export function shortBuildId(raw: string | null | undefined): string | null {
  return typeof raw === "string" && BUILD_ID_PATTERN.test(raw)
    ? raw.slice(0, SHORT_BUILD_ID_LENGTH)
    : null;
}

export function appBuildId(): string | null {
  // Read as `process.env.EXPO_PUBLIC_BUILD_ID` literally: the bundler only
  // inlines EXPO_PUBLIC_ variables written out in full.
  return shortBuildId(process.env.EXPO_PUBLIC_BUILD_ID);
}

export function appVersionStamp(): string | null {
  const version = appVersion();
  if (!version) {
    return null;
  }
  const build = appBuildId();
  return build ? `${version}+${build}` : version;
}
