/** What handing an image to the system did, for the sheet's status line. */
export type ImageDeliveryOutcome =
  /** The system share sheet took it (phone, or a browser that shares files). */
  | "shared"
  /** The user closed the share dialog without choosing a target. */
  | "cancelled"
  /** No share sheet for files: the PNG was downloaded and the caption copied. */
  | "downloaded"
  /** Nothing could take the file. */
  | "unavailable";

export interface ImageDeliveryRequest {
  fileName: string;
  /** The caption, which web fallbacks copy because a download cannot carry text. */
  caption: string;
  /** Share dialog title. */
  title: string;
}
