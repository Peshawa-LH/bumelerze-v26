import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/**
 * Hands a recording to the person as a file. Phone: written to the app's
 * cache folder as `bumelerze-accel-<time>Z.txt` and offered through the
 * system share sheet (Save to Files, Mail, AirDrop to a computer), the same
 * way "Download my data" hands over its file. Twin of `save-recording.web.ts`
 * (a browser download).
 *
 * Before, the phone wrote the text without creating the file first and
 * passed it to React Native's share sheet, which drops a file on Android.
 * Rejects when the phone has no share sheet, so the panel says "Saving
 * failed on this device".
 */
export async function saveRecordingText(text: string, fileName: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("no share sheet on this device");
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/plain",
    UTI: "public.plain-text",
    dialogTitle: fileName,
  });
}
