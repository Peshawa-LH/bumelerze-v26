import type { DeliveryOutcome } from "./types";

/**
 * Browser: a plain download of the JSON file (the browser's own save). Twin of
 * `deliver.ts` (phones, share sheet).
 */
export async function deliverJsonFile(
  text: string,
  fileName: string,
  _title: string,
): Promise<DeliveryOutcome> {
  if (typeof document === "undefined") {
    return "unavailable";
  }
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
