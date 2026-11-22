import type { TurnstileTheme } from "./bridge";
import type { TurnstileLanguage } from "./config";

/** Props of `TurnstileFrame` (web: `TurnstileFrame.web.tsx`, the widget on
 * the page; iOS/Android: `TurnstileFrame.tsx`, a WebView of
 * `public/turnstile.html`). One frame = one widget = at most one outcome:
 * a token, a failure, or (hidden only) "needs a tap". */
export interface TurnstileFrameProps {
  siteKey: string;
  /** false: nothing is drawn unless Turnstile needs a tap, which is then
   * reported through `onInteractive`; true: drawn in the "Quick check"
   * sheet. */
  visible: boolean;
  language: TurnstileLanguage;
  theme: TurnstileTheme;
  accessibilityLabel: string;
  onToken: (token: string) => void;
  onFailure: () => void;
  onInteractive: () => void;
}

/** Turnstile "normal" widget size (300 x 65) plus room. */
export const TURNSTILE_FRAME_WIDTH = 300;
export const TURNSTILE_FRAME_HEIGHT = 80;
