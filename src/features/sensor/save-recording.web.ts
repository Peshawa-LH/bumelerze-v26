/**
 * Hands a recording to the person as a file: a download of a text blob (the
 * browser's own save sheet). Twin of `save-recording.ts` (phones).
 */
export async function saveRecordingText(text: string, fileName: string): Promise<void> {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
