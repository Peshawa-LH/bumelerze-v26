import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { DeliveryOutcome } from "./types";

/**
 * Phones: writes the JSON to the app's cache folder and opens the system share
 * sheet, so the person can save it to Files, send it to themself or to a
 * computer. Twin of `deliver.web.ts` (a browser download).
 */
export async function deliverJsonFile(
  text: string,
  fileName: string,
  title: string,
): Promise<DeliveryOutcome> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) {
    return "unavailable";
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    UTI: "public.json",
    dialogTitle: title,
  });
  return "shared";
}
