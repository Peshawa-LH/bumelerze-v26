import { Alert, Platform } from "react-native";

import { confirmDialog, messageDialog } from "../dialogs";

const originalOS = Platform.OS;

function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

afterEach(() => {
  setOS(originalOS);
  jest.restoreAllMocks();
});

describe("confirmDialog on web (React Native Web's Alert does nothing)", () => {
  beforeEach(() => setOS("web"));

  it("asks with the browser's confirm and runs the action on OK", () => {
    const confirm = jest.fn(() => true);
    (globalThis as { confirm?: unknown }).confirm = confirm;
    const onConfirm = jest.fn();

    confirmDialog({
      title: "Replay onboarding?",
      message: "You'll see the welcome screens again.",
      confirmLabel: "Replay onboarding",
      cancelLabel: "Cancel",
      onConfirm,
    });

    expect(confirm).toHaveBeenCalledWith(
      "Replay onboarding?\n\nYou'll see the welcome screens again.",
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the person cancels", () => {
    (globalThis as { confirm?: unknown }).confirm = jest.fn(() => false);
    const onConfirm = jest.fn();

    confirmDialog({
      title: "t",
      message: "m",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      onConfirm,
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a one-button notice shows an alert and then runs the action", () => {
    const alert = jest.fn();
    (globalThis as { alert?: unknown }).alert = alert;
    const onConfirm = jest.fn();

    confirmDialog({ title: "t", message: "m", confirmLabel: "Play", onConfirm });

    expect(alert).toHaveBeenCalledWith("t\n\nm");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("messageDialog uses the browser's alert", () => {
    const alert = jest.fn();
    (globalThis as { alert?: unknown }).alert = alert;
    const spy = jest.spyOn(Alert, "alert");

    messageDialog("t", "m");

    expect(alert).toHaveBeenCalledWith("t\n\nm");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("confirmDialog on a phone", () => {
  beforeEach(() => setOS("ios"));

  it("uses the system dialog with cancel and confirm buttons", () => {
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onConfirm = jest.fn();

    confirmDialog({
      title: "t",
      message: "m",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      onConfirm,
    });

    const buttons = spy.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual(["Cancel", "OK"]);
    buttons[1]?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
