import { Platform, Share } from "react-native";

/**
 * Hands a recording to the person as a file. Web: a download of a text
 * blob (the browser's own save sheet). Native: written to the cache
 * directory and offered through the system share sheet, so it can go to
 * Files, Mail or a computer without any extra module.
 */
export async function saveRecordingText(text: string, fileName: string): Promise<void> {
  if (Platform.OS === "web") {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const { File, Paths } = await import("expo-file-system");
  const file = new File(Paths.cache, fileName);
  file.write(text);
  await Share.share({ url: file.uri, title: fileName, message: fileName });
}
