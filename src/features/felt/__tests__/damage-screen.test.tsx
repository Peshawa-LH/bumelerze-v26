import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { BUILDING_DAMAGE_GRADES, DAMAGE_TYPOLOGIES, useTier2DraftStore } from "../";

/**
 * Window 2 — damage picker (2026-08-15 flow restructure, owner directive).
 * Every tile (including the generic "no damage" default) both records the
 * pick in the shared post-tier-1 draft and navigates to window 3
 * immediately — see `flow-integration.test.tsx` for the end-to-end version
 * of this against the real queue.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ feltReportId: "report-1", eventId: "evt-1" }),
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
  }),
}));

// eslint-disable-next-line import/first -- after the mock above, see comment
import DamageReportScreen from "../../../../app/felt-report/damage";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("Window 2 — damage picker screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    useTier2DraftStore.getState().reset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders both typology rows (5 grades each, DG1-DG5) and the generic no-damage default", async () => {
    await act(async () => {
      renderWithProviders(<DamageReportScreen />);
    });

    for (const typology of DAMAGE_TYPOLOGIES) {
      for (const grade of BUILDING_DAMAGE_GRADES) {
        const label = i18n.t(`felt.damage.grades.${typology}.${grade}`);
        const typologyLabel = i18n.t(`felt.damage.typologies.${typology}`);
        expect(screen.getByLabelText(`${typologyLabel}. ${label}`)).toBeTruthy();
      }
    }

    expect(
      screen.getByRole("button", { name: i18n.t("felt.damage.noDamage.label") }),
    ).toBeTruthy();
  });

  it("picking a typology grade records typology+grade in the draft and navigates to window 3", async () => {
    await act(async () => {
      renderWithProviders(<DamageReportScreen />);
    });

    const label = i18n.t("felt.damage.grades.lowrise.3");
    const typologyLabel = i18n.t("felt.damage.typologies.lowrise");
    const tile = screen.getByLabelText(`${typologyLabel}. ${label}`);

    fireEvent.press(tile);

    const draft = useTier2DraftStore.getState();
    expect(draft.answers.damageTypology).toBe("lowrise");
    expect(draft.answers.buildingDamageLevel).toBe(3);

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/details",
        params: expect.objectContaining({ feltReportId: "report-1", eventId: "evt-1" }),
      }),
    );
  });

  it("the generic 'no damage' shortcut sets grade 1 with NO typology (distinct from picking a row's DG1 tile)", async () => {
    await act(async () => {
      renderWithProviders(<DamageReportScreen />);
    });

    const noDamageButton = screen.getByRole("button", {
      name: i18n.t("felt.damage.noDamage.label"),
    });
    fireEvent.press(noDamageButton);

    const draft = useTier2DraftStore.getState();
    expect(draft.answers.buildingDamageLevel).toBe(1);
    expect(draft.answers.damageTypology).toBeNull();
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/felt-report/details" }),
    );
  });
});
