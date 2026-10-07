import { ARABIC_SCRIPT_FONT } from "@/theme/typography";

/** The two faces the share card uses, by the names `app/_layout.tsx` registers
 * them under. Vazirmatn covers Latin and Arabic script alike, so the image looks
 * the same in every language and on every device. Kept apart from the React
 * component so the web exporter can name them without importing it. */
export const SHARE_FONT_REGULAR = `${ARABIC_SCRIPT_FONT}-Regular`;
export const SHARE_FONT_BOLD = `${ARABIC_SCRIPT_FONT}-Bold`;
