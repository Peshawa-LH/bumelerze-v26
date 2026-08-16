import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { PossibleEventCard } from "../components/PossibleEventCard";
import type { PossibleEvent } from "../possible";

/**
 * Dedicated render coverage for `PossibleEventCard` (D26 item 3) — the
 * message/a11y-label content and locale/RTL behavior are exercised
 * end-to-end via `home-screen.test.tsx`'s own possible-event tests; this
 * file focuses specifically on the relative-time line's digit
 * localization (`formatRelativeTimeValue` -> `localizeDigits`, same path
 * `EventCard` uses), which needs its own render, not Home's.
 */
describe("PossibleEventCard", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  const slemani: PossibleEvent = {
    id: "possible-1",
    originTime: Date.now() - 5 * 60_000, // 5 minutes ago
    lat: 35.56,
    lon: 45.43,
    createdAt: Date.now() - 4 * 60_000,
  };

  it("renders the relative-time line with Latin digits in English", async () => {
    await i18n.changeLanguage("en");
    await render(<PossibleEventCard event={slemani} />);

    expect(
      screen.getByText(i18n.t("events.relativeTime.minutes", { value: "5" })),
    ).toBeTruthy();
  });

  it("renders the relative-time line with Eastern Arabic-Indic digits in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await render(<PossibleEventCard event={slemani} />);

    // "٥" is the Eastern Arabic-Indic glyph for 5 — same digit-localization
    // convention as EventCard's magnitude/relative-time strings
    // (ui-backlog.md wave 5 item 1).
    expect(
      screen.getByText(i18n.t("events.relativeTime.minutes", { value: "٥" })),
    ).toBeTruthy();
  });

  it("includes both the message and the relative time in the alert's accessibility label", async () => {
    await i18n.changeLanguage("ckb");
    await render(<PossibleEventCard event={slemani} />);

    const alert = screen.getByRole("alert");
    expect(alert.props.accessibilityLabel).toMatch(/سلێمانی/);
    expect(alert.props.accessibilityLabel).toContain(
      i18n.t("events.relativeTime.minutes", { value: "٥" }),
    );
  });
});
