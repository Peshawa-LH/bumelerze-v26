/** The two share-image formats (owner note N14): a square post and a tall story. */
export type ShareCardSize = "square" | "story";

export const SHARE_CARD_SIZES: readonly ShareCardSize[] = ["square", "story"];

/** One rendered share image, ready to hand to the system share sheet. */
export interface ShareImage {
  size: ShareCardSize;
  width: number;
  height: number;
  /** PNG bytes, base64 (no `data:` prefix). */
  base64: string;
}
