/**
 * Admin > Alerts (migration 0062): hidden without alerts.test; readable with
 * it; the rollout switch and the tester list only with alerts.manage (the
 * server re-checks); "Everyone" and "Nobody" need a confirmation; testers are
 * added by @username; the last runs and a test alert are there.
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { makeTransport, renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { AlertsAdminContent } from "../components/AlertsAdminContent";
import type { AlertsTransport } from "../transport";
import { AlertsError, type AlertsOverview } from "../types";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "official-1" }),
}));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const OVERVIEW: AlertsOverview = {
  mode: "testers",
  canManage: true,
  devices: 3,
  waiting: 0,
  testers: [
    { userId: "u-owner", username: "peshawa", displayName: "Peshawa", via: "rank", devices: 2 },
    { userId: "u-dilan", username: "dilan", displayName: "Dilan", via: "allowlist", devices: 1 },
  ],
  runs: [
    {
      runId: "r1",
      startedAt: Date.parse("2026-10-09T10:00:00Z"),
      mode: "testers",
      events: 1,
      planned: 3,
      suppressed: 1,
      claimed: 2,
      sent: 2,
      failed: 0,
      gone: 0,
    },
  ],
};

function makeAlerts(over: Partial<AlertsTransport> = {}): jest.Mocked<AlertsTransport> {
  return {
    fetchAccess: jest.fn(),
    registerWebPush: jest.fn(),
    unregisterWebPush: jest.fn(),
    savePreferences: jest.fn(),
    sendTest: jest.fn(async () => 1),
    fetchOverview: jest.fn(async () => OVERVIEW),
    setMode: jest.fn(async (mode) => ({ ...OVERVIEW, mode })),
    addTester: jest.fn(async () => OVERVIEW),
    removeTester: jest.fn(async () => OVERVIEW),
    ...over,
  } as jest.Mocked<AlertsTransport>;
}

async function renderScreen(permissions: Permission[], alerts = makeAlerts()) {
  await renderWithProviders(
    <AlertsAdminContent transport={alerts} hubTransport={makeTransport({ permissions })} />,
  );
  return alerts;
}

describe("Admin > Alerts", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockConfirm.mockReset();
  });
  afterEach(cleanup);

  it("without alerts.test: 'not allowed', and the server is not asked", async () => {
    const alerts = await renderScreen(["comments.moderate", "filter.manage"]);
    expect(await screen.findByTestId("alerts-admin-no-access")).toBeTruthy();
    expect(alerts.fetchOverview).not.toHaveBeenCalled();
  });

  it("shows the mode, testers (rank and allowlist), devices and the last runs", async () => {
    await renderScreen(["alerts.test", "alerts.manage"]);
    expect(await screen.findByTestId("alerts-admin-mode-now")).toBeTruthy();
    expect(screen.getByTestId("alerts-admin-mode-now").props.children).toBe("Testers only");
    expect(screen.getByText("Peshawa @peshawa")).toBeTruthy();
    expect(screen.getByText("By rank · Devices: 2")).toBeTruthy();
    expect(screen.getByText("Devices: 1")).toBeTruthy();
    expect(screen.getByText("Devices with alerts on: 3 · Waiting: 0")).toBeTruthy();
    expect(screen.getByText("Planned 3 · sent 2 · failed 0 · held back 1")).toBeTruthy();
    // a rank holder cannot be removed here; an allowlisted one can
    expect(screen.queryByTestId("alerts-admin-remove-u-owner")).toBeNull();
    expect(screen.getByTestId("alerts-admin-remove-u-dilan")).toBeTruthy();
  });

  it("read-only without alerts.manage: no switch, no add, no remove", async () => {
    await renderScreen(["alerts.test"], makeAlerts({ fetchOverview: jest.fn(async () => ({ ...OVERVIEW, canManage: false })) }));
    expect(await screen.findByTestId("alerts-admin-mode-now")).toBeTruthy();
    expect(screen.queryByTestId("alerts-admin-mode-public")).toBeNull();
    expect(screen.queryByTestId("alerts-admin-add-input")).toBeNull();
    expect(screen.queryByTestId("alerts-admin-remove-u-dilan")).toBeNull();
  });

  it("'Everyone' asks first, and only the confirmation switches", async () => {
    const alerts = await renderScreen(["alerts.test", "alerts.manage"]);
    await fireEvent.press(await screen.findByTestId("alerts-admin-mode-public"));
    expect(alerts.setMode).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Send alerts to everyone?", confirmLabel: "Send to everyone" }),
    );
    await act(async () => {
      (mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void }).onConfirm();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(alerts.setMode).toHaveBeenCalledWith("public");
    await waitFor(() => expect(screen.getByTestId("alerts-admin-mode-now").props.children).toBe("Everyone"));
  });

  it("'Nobody (paused)' asks first too", async () => {
    await renderScreen(["alerts.test", "alerts.manage"]);
    await fireEvent.press(await screen.findByTestId("alerts-admin-mode-off"));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Pause all alerts?" }));
  });

  it("adds a tester by @username and says when nobody has it", async () => {
    const alerts = await renderScreen(["alerts.test", "alerts.manage"]);
    await fireEvent.changeText(await screen.findByTestId("alerts-admin-add-input"), "@aso");
    await fireEvent.press(screen.getByTestId("alerts-admin-add"));
    expect(alerts.addTester).toHaveBeenCalledWith("aso");
    alerts.addTester.mockRejectedValueOnce(new AlertsError("not_found"));
    await fireEvent.changeText(screen.getByTestId("alerts-admin-add-input"), "nobody");
    await fireEvent.press(screen.getByTestId("alerts-admin-add"));
    expect(await screen.findByText("No person with that username.")).toBeTruthy();
  });

  it("removes an allowlisted tester", async () => {
    const alerts = await renderScreen(["alerts.test", "alerts.manage"]);
    await fireEvent.press(await screen.findByTestId("alerts-admin-remove-u-dilan"));
    expect(alerts.removeTester).toHaveBeenCalledWith("u-dilan");
  });

  it("sends a test alert through the real pipeline", async () => {
    const alerts = await renderScreen(["alerts.test"]);
    await fireEvent.press(await screen.findByTestId("alerts-admin-send-test"));
    expect(alerts.sendTest).toHaveBeenCalled();
    expect(await screen.findByTestId("alerts-admin-test-result")).toBeTruthy();
  });
});
