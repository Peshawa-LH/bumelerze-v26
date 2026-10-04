import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { PossibleEventCard } from "../components/PossibleEventCard";
import type { PossibleEvent } from "../possible";

/**
 * PossibleEventCard (crowd detection v2): two stages, the number of people,
 * "not yet confirmed" wording, and digit localization.
 */
describe("PossibleEventCard", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  const fresh = (): PossibleEvent => ({
    id: "possible-1",
    originTime: Date.now() - 4 * 60_000,
    lat: 35.56,
    lon: 45.43,
    createdAt: Date.now() - 3 * 60_000,
    firstReportAt: Date.now() - 5 * 60_000,
    userCount: 12,
  });

  it("shows a fresh detection as an alert that says shaking, not yet confirmed, with the count", async () => {
    await i18n.changeLanguage("en");
    await render(<PossibleEventCard event={fresh()} />);
    expect(screen.getByTestId("possible-event-fresh")).toBeTruthy();
    expect(screen.getByText(i18n.t("home.possibleEvent.notConfirmed"))).toBeTruthy();
    expect(screen.getByText(/12\S* people · /)).toBeTruthy();
    expect(screen.getByRole("alert").props.accessibilityLabel).toContain(
      i18n.t("events.relativeTime.minutes", { value: "5" }),
    );
  });

  it("mutes a detection older than 30 minutes and drops the alert role", async () => {
    await i18n.changeLanguage("en");
    await render(
      <PossibleEventCard
        event={{ ...fresh(), firstReportAt: Date.now() - 45 * 60_000 }}
      />,
    );
    expect(screen.getByTestId("possible-event-stale")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(i18n.t("home.possibleEvent.notConfirmed"))).toBeNull();
  });

  it("uses Eastern Arabic-Indic digits and the Sorani city name", async () => {
    await i18n.changeLanguage("ckb");
    await render(<PossibleEventCard event={fresh()} />);
    expect(screen.getByText(/١٢/)).toBeTruthy();
    expect(screen.getByRole("alert").props.accessibilityLabel).toMatch(/سلێمانی/);
  });

  it("omits the count for detections made before people were counted", async () => {
    await i18n.changeLanguage("en");
    await render(<PossibleEventCard event={{ ...fresh(), userCount: null }} />);
    expect(
      screen.getByText(i18n.t("events.relativeTime.minutes", { value: "5" })),
    ).toBeTruthy();
  });
});
