import type { TFunction } from "i18next";

import type { ReportInput } from "./report-html";

/**
 * Native default: no printing. The browser's print dialog is what turns the
 * report into a PDF, and there is no native print module in this app (that
 * would need the dev build the owner does not have yet). Rather than show a
 * button that does nothing, `canPrintReport` is false here and the UI hides
 * it — same platform-split convention as `MapCoordinatePicker`.
 */
export const canPrintReport = false;

export function printReport(_data: ReportInput, _t: TFunction): void {
  // Intentionally empty; `canPrintReport` gates the caller.
}
