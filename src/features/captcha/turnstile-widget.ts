import type { TurnstileAppearance, TurnstileTheme } from "./bridge";
import type { TurnstileLanguage } from "./config";
import type { TurnstileApi } from "./turnstile-script.web";

/**
 * Draws one Turnstile widget into `container` and reports exactly one
 * outcome. The same settings as `public/turnstile.html` (iOS/Android):
 * - `appearance` "interaction-only" while hidden: nothing is drawn unless
 *   Turnstile wants a tap, which is reported (`onInteractive`) so the host
 *   can show the "Quick check" sheet instead;
 * - `retry` and `refresh-expired` "never": one attempt, fail fast; the auth
 *   call then goes ahead without a token and the app's own queues retry;
 * - no hidden form field (`response-field` false): the token goes straight
 *   into the auth call.
 * Returns the clean-up that removes the widget.
 */
export interface TurnstileWidgetOptions {
  siteKey: string;
  language: TurnstileLanguage;
  theme: TurnstileTheme;
  appearance: TurnstileAppearance;
}

export interface TurnstileWidgetHandlers {
  onToken: (token: string) => void;
  onFailure: () => void;
  onInteractive: () => void;
}

export function mountTurnstileWidget(
  api: TurnstileApi,
  container: unknown,
  options: TurnstileWidgetOptions,
  handlers: TurnstileWidgetHandlers,
): () => void {
  let settled = false;
  const settle = (outcome: () => void) => {
    if (settled) {
      return;
    }
    settled = true;
    outcome();
  };
  const fail = () => settle(handlers.onFailure);

  if (!container) {
    fail();
    return () => undefined;
  }

  let widgetId: string | null | undefined = null;
  try {
    widgetId = api.render(container as HTMLElement, {
      sitekey: options.siteKey,
      theme: options.theme,
      language: options.language,
      appearance: options.appearance,
      size: options.appearance === "always" ? "flexible" : "normal",
      execution: "render",
      retry: "never",
      "refresh-expired": "never",
      "response-field": false,
      callback: (token: unknown) => {
        if (typeof token === "string" && token.length > 0) {
          settle(() => handlers.onToken(token));
        } else {
          fail();
        }
      },
      // Returning true tells Turnstile the error is handled here.
      "error-callback": () => {
        fail();
        return true;
      },
      "expired-callback": fail,
      "timeout-callback": fail,
      "unsupported-callback": fail,
      "before-interactive-callback": () => {
        if (!settled && options.appearance !== "always") {
          handlers.onInteractive();
        }
      },
    });
  } catch {
    fail();
  }
  if (!widgetId) {
    fail();
  }

  return () => {
    settled = true;
    if (widgetId) {
      try {
        api.remove(widgetId);
      } catch {
        // Already gone with its container.
      }
    }
  };
}
