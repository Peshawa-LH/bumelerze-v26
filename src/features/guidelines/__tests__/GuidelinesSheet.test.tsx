import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { GuidelinesRow } from "../components/GuidelinesRow";
import { GuidelinesSheet } from "../components/GuidelinesSheet";
import { GUIDELINE_RULES } from "../constants";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: jest.fn(async () => undefined),
}));

describe("GuidelinesSheet", () => {
  afterEach(async () => {
    cleanup();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  it("shows the five rules", async () => {
    await renderWithProviders(
      <GuidelinesSheet
        mode="accept"
        onClose={jest.fn()}
        transport={{ accept: jest.fn() }}
      />,
    );
    expect(screen.getByText("Community guidelines")).toBeTruthy();
    expect(GUIDELINE_RULES).toHaveLength(5);
    for (const rule of GUIDELINE_RULES) {
      expect(screen.getByTestId(`guidelines-sheet-rule-${rule}`)).toBeTruthy();
    }
    expect(screen.getByText("No predictions or rumours")).toBeTruthy();
    expect(screen.getByText("No private information about others")).toBeTruthy();
    expect(screen.getByText("No graphic images")).toBeTruthy();
    expect(screen.getByText("Be respectful")).toBeTruthy();
    expect(screen.getByText("Felt reports are for real experiences")).toBeTruthy();
  });

  it("keeps I agree off until the age tick is set", async () => {
    const accept = jest.fn(async () => undefined);
    const onAccepted = jest.fn();
    await renderWithProviders(
      <GuidelinesSheet
        mode="accept"
        onClose={jest.fn()}
        onAccepted={onAccepted}
        transport={{ accept }}
      />,
    );
    const agree = () => screen.getByTestId("guidelines-sheet-agree");
    expect(agree().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(agree());
    expect(accept).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("guidelines-sheet-age"));
    expect(screen.getByText("I am 13 or older.")).toBeTruthy();
    expect(agree().props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(agree());
    await waitFor(() => expect(accept).toHaveBeenCalledWith("prompt"));
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("stays open with a message when saving fails", async () => {
    const accept = jest.fn(async () => {
      throw new Error("offline");
    });
    const onAccepted = jest.fn();
    await renderWithProviders(
      <GuidelinesSheet
        mode="accept"
        onClose={jest.fn()}
        onAccepted={onAccepted}
        transport={{ accept }}
      />,
    );
    await fireEvent.press(screen.getByTestId("guidelines-sheet-age"));
    await fireEvent.press(screen.getByTestId("guidelines-sheet-agree"));
    expect(await screen.findByTestId("guidelines-sheet-error")).toBeTruthy();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("Not now closes without saving", async () => {
    const accept = jest.fn();
    const onClose = jest.fn();
    await renderWithProviders(
      <GuidelinesSheet mode="accept" onClose={onClose} transport={{ accept }} />,
    );
    await fireEvent.press(screen.getByTestId("guidelines-sheet-later"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
  });

  it("read mode has no agree button and no age tick", async () => {
    await renderWithProviders(<GuidelinesSheet mode="read" onClose={jest.fn()} />);
    expect(screen.queryByTestId("guidelines-sheet-agree")).toBeNull();
    expect(screen.queryByTestId("guidelines-sheet-age")).toBeNull();
    expect(screen.getByTestId("guidelines-sheet-close-button")).toBeTruthy();
  });

  it("passes the source through (sign-up)", async () => {
    const accept = jest.fn(async () => undefined);
    await renderWithProviders(
      <GuidelinesSheet
        mode="accept"
        source="signup"
        onClose={jest.fn()}
        transport={{ accept }}
      />,
    );
    await fireEvent.press(screen.getByTestId("guidelines-sheet-age"));
    await fireEvent.press(screen.getByTestId("guidelines-sheet-agree"));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("signup"));
  });

  it.each(["ckb", "kmr", "ar"])("is worded in %s without a raw key", async (locale) => {
    await i18n.changeLanguage(locale);
    await renderWithProviders(
      <GuidelinesSheet
        mode="accept"
        onClose={jest.fn()}
        transport={{ accept: jest.fn() }}
      />,
    );
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/guidelines\.|report\./);
    for (const rule of GUIDELINE_RULES) {
      expect(screen.getByTestId(`guidelines-sheet-rule-${rule}`)).toBeTruthy();
    }
  });
});

describe("GuidelinesRow", () => {
  afterEach(cleanup);

  it("opens the guidelines to read, from Settings", async () => {
    await renderWithProviders(<GuidelinesRow />);
    expect(screen.getByText("Community guidelines")).toBeTruthy();
    expect(screen.queryByTestId("guidelines-read")).toBeNull();
    await fireEvent.press(screen.getByTestId("settings-row-guidelines"));
    expect(screen.getByTestId("guidelines-read")).toBeTruthy();
    expect(screen.queryByTestId("guidelines-read-agree")).toBeNull();
    await fireEvent.press(screen.getByTestId("guidelines-read-close-button"));
    expect(screen.queryByTestId("guidelines-read")).toBeNull();
  });
});
