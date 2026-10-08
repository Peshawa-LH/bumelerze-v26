import * as Clipboard from "expo-clipboard";
import type { TFunction } from "i18next";
import { Share } from "react-native";

import { formatClockTime, isolateNumeric } from "@/features/events";

/**
 * The "I'm safe" message for relatives without the app (WhatsApp, Viber,
 * SMS, Telegram through the system share sheet). Works for guests too.
 *
 * It says which earthquake by its TIME only: no place name, no coordinates,
 * no link, no account name. Nothing about it touches our servers.
 */
export function buildSafeShareMessage(
  t: TFunction,
  locale: string,
  eventOriginTime: number | null,
): string {
  if (eventOriginTime === null || !Number.isFinite(eventOriginTime)) {
    return t("imSafe.share.messageNoTime");
  }
  return t("imSafe.share.message", {
    time: isolateNumeric(formatClockTime(eventOriginTime, locale, t)),
  });
}

/** Opens the share sheet; without one (some browsers) copies the text and
 * returns "copied" so the screen can say so. */
export async function shareSafeMessage(message: string): Promise<"shared" | "copied"> {
  try {
    await Share.share({ message });
    return "shared";
  } catch {
    await Clipboard.setStringAsync(message);
    return "copied";
  }
}
