import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import { EMPTY_BADGE_INPUTS, evaluateBadges, type BadgeInputs } from "../evaluate";
import { BadgeGrid } from "../components/BadgeGrid";
import { BadgesSection } from "../components/BadgesSection";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderGrid(
  inputs: Partial<BadgeInputs>,
  roles: Parameters<typeof evaluateBadges>[1] = [],
) {
  const entries = evaluateBadges({ ...EMPTY_BADGE_INPUTS, ...inputs }, roles);
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <BadgeGrid entries={entries} />
    </SafeAreaProvider>,
  );
}

describe("BadgeGrid", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("renders all nine milestones, earned ones with a plain 'earned' label, locked ones with progress", async () => {
    await renderGrid({ reports: 3 });
    expect(screen.getAllByTestId(/^badge-(?!lock|grid|sheet|icon)/)).toHaveLength(9);
    expect(screen.getByLabelText("First report, earned")).toBeTruthy();
    expect(screen.getByLabelText("10 reports, locked, 3 of 10")).toBeTruthy();
    expect(screen.getByLabelText("Photographer, locked, 0 of 1")).toBeTruthy();
    // Earned has no lock dot; locked ones do: not colour alone.
    expect(
      screen.getAllByTestId("badge-lock", { includeHiddenElements: true }),
    ).toHaveLength(8);
  });

  it("puts a held role first and draws the official one with the app icon", async () => {
    await renderGrid({}, [{ role: "official", orgName: null }]);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.props.testID).toBe("badge-role-official");
    expect(screen.getByLabelText("Bumelerze, earned")).toBeTruthy();
    expect(
      screen.getByTestId("badge-icon-image", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it("names a partner badge after its organisation", async () => {
    await renderGrid({}, [{ role: "partner", orgName: "Kurdistan Seismology" }]);
    expect(screen.getByLabelText("Kurdistan Seismology, earned")).toBeTruthy();
  });

  it("opens the sheet on tap: locked countable badge shows rule and 'n / target' progress", async () => {
    await renderGrid({ reports: 3 });
    expect(screen.queryByTestId("badge-sheet")).toBeNull();
    await fireEvent.press(screen.getByTestId("badge-reports_10"));
    expect(screen.getByTestId("badge-sheet")).toBeTruthy();
    expect(screen.getByText("Send 10 felt reports.")).toBeTruthy();
    expect(screen.getByTestId("badge-sheet-locked")).toBeTruthy();
    expect(screen.getByTestId("badge-sheet-progress").props.children).toBe("⁦3 / 10⁩");
    expect(screen.getByTestId("badge-sheet-progress").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ writingDirection: "ltr" })]),
    );
    expect(screen.getByTestId("badge-sheet-progress-fill").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: "30%" })]),
    );
  });

  it("shows 'Earned' for an earned badge and a role rule for roles", async () => {
    await renderGrid({ reports: 1 }, [{ role: "moderator", orgName: null }]);
    await fireEvent.press(screen.getByTestId("badge-first_report"));
    expect(screen.getByTestId("badge-sheet-earned")).toBeTruthy();
    expect(screen.getByText("Earned")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("badge-sheet-close"));
    await fireEvent.press(screen.getByTestId("badge-role-moderator"));
    expect(screen.getByText("Given by the Bumelerze team.")).toBeTruthy();
  });

  it("a locked single-step badge has no progress bar", async () => {
    await renderGrid({});
    await fireEvent.press(screen.getByTestId("badge-photo"));
    expect(screen.getByTestId("badge-sheet-locked")).toBeTruthy();
    expect(screen.queryByTestId("badge-sheet-progress")).toBeNull();
  });

  it("closes with the X, the scrim and Android back", async () => {
    await renderGrid({ reports: 1 });
    await fireEvent.press(screen.getByTestId("badge-first_report"));
    await fireEvent.press(screen.getByTestId("badge-sheet-close"));
    expect(screen.queryByTestId("badge-sheet")).toBeNull();

    await fireEvent.press(screen.getByTestId("badge-first_report"));
    await fireEvent.press(screen.getByTestId("badge-sheet-scrim"));
    expect(screen.queryByTestId("badge-sheet")).toBeNull();

    await fireEvent.press(screen.getByTestId("badge-first_report"));
    await act(async () => {
      screen.getByTestId("badge-sheet-modal").props.onRequestClose();
    });
    expect(screen.queryByTestId("badge-sheet")).toBeNull();
  });

  it("fades in normally", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    await renderGrid({ reports: 1 });
    await fireEvent.press(screen.getByTestId("badge-first_report"));
    expect(screen.getByTestId("badge-sheet-modal").props.animationType).toBe("fade");
  });

  it("does not animate under reduce-motion", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await renderGrid({ reports: 1 });
    await fireEvent.press(screen.getByTestId("badge-first_report"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("badge-sheet-modal").props.animationType).toBe("none");
  });

  it("localizes the progress digits in Sorani and keeps them isolated left-to-right", async () => {
    await i18n.changeLanguage("ckb");
    await renderGrid({ reports: 3 });
    await fireEvent.press(screen.getByTestId("badge-reports_10"));
    expect(screen.getByTestId("badge-sheet-progress").props.children).toBe("⁦٣ / ١٠⁩");
  });
});

describe("BadgesSection", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the title and the earned/total counter", async () => {
    const entries = evaluateBadges({ ...EMPTY_BADGE_INPUTS, reports: 1 }, []);
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <BadgesSection entries={entries} earned={1} total={9} />
      </SafeAreaProvider>,
    );
    expect(screen.getByText("Badges")).toBeTruthy();
    expect(screen.getByTestId("badges-counter").props.children).toBe("1/9");
  });
});
