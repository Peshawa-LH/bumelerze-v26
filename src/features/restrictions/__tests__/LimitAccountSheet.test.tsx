import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { LimitAccountSheet } from "../components/LimitAccountSheet";
import { parseEndDate } from "../date-input";
import { DAY, fakeTransport } from "../__fixtures__/testing";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

const TARGET = { userId: "u-target", name: "Dilan" };

async function open(canSuspend: boolean, transport = fakeTransport()) {
  const onClose = jest.fn();
  await renderWithProviders(
    <LimitAccountSheet
      target={TARGET}
      canSuspend={canSuspend}
      onClose={onClose}
      transport={transport}
    />,
  );
  return { transport, onClose };
}

describe("LimitAccountSheet", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("what each rank is offered", () => {
    it("a moderator gets warning and restrict, for 24 hours or 7 days only", async () => {
      await open(false);
      expect(screen.getByTestId("limit-sheet-target")).toHaveTextContent("Dilan");
      expect(screen.getByTestId("limit-level-warning")).toBeTruthy();
      expect(screen.getByTestId("limit-level-restrict")).toBeTruthy();
      expect(screen.queryByTestId("limit-level-suspend")).toBeNull();
      expect(screen.getByTestId("limit-duration-h24")).toBeTruthy();
      expect(screen.getByTestId("limit-duration-d7")).toBeTruthy();
      expect(screen.queryByTestId("limit-duration-d30")).toBeNull();
      expect(screen.queryByTestId("limit-duration-custom")).toBeNull();
      expect(screen.queryByTestId("limit-duration-open")).toBeNull();
    });

    it("the official rank also gets suspend, 30 days and a date of its own; 'until lifted' only for suspend", async () => {
      await open(true);
      expect(screen.getByTestId("limit-level-suspend")).toBeTruthy();
      expect(screen.getByTestId("limit-duration-d30")).toBeTruthy();
      expect(screen.getByTestId("limit-duration-custom")).toBeTruthy();
      expect(screen.queryByTestId("limit-duration-open")).toBeNull();
      await fireEvent.press(screen.getByTestId("limit-level-suspend"));
      expect(screen.getByTestId("limit-duration-open")).toBeTruthy();
    });

    it("says in words what the chosen level does", async () => {
      await open(true);
      expect(screen.getByTestId("limit-level-hint")).toHaveTextContent(
        /Felt reports and alerts keep working/,
      );
      await fireEvent.press(screen.getByTestId("limit-level-suspend"));
      expect(screen.getByTestId("limit-level-hint")).toHaveTextContent(
        /hidden from others/,
      );
    });

    it("offers the five reason presets, including the rumour one", async () => {
      await open(false);
      for (const id of ["rumour", "harassment", "spam", "impersonation", "explicit"]) {
        expect(screen.getByTestId(`limit-reason-${id}`)).toBeTruthy();
      }
      expect(screen.getByText("Fake earthquake prediction or rumour")).toBeTruthy();
      expect(screen.getByText("Sexual or violent content")).toBeTruthy();
    });
  });

  describe("sending", () => {
    it("cannot be sent without a reason", async () => {
      const { transport } = await open(false);
      expect(screen.getByTestId("limit-submit").props.accessibilityState.disabled).toBe(
        true,
      );
      await fireEvent.press(screen.getByTestId("limit-submit"));
      expect(transport.restrict).not.toHaveBeenCalled();
    });

    it("restricts for 7 days with a preset reason, then offers Undo for 10 seconds that lifts it", async () => {
      const { transport, onClose } = await open(false);
      await fireEvent.press(screen.getByTestId("limit-reason-rumour"));
      const before = Date.now();
      await fireEvent.press(screen.getByTestId("limit-submit"));
      await waitFor(() => expect(transport.restrict).toHaveBeenCalledTimes(1));
      const input = transport.restrict.mock.calls[0]?.[0];
      expect(input).toMatchObject({
        userId: "u-target",
        level: "restrict",
        reason: "rumour",
        note: null,
      });
      const ends = Date.parse(input?.endsAt as string);
      expect(ends).toBeGreaterThanOrEqual(before + 7 * DAY);
      expect(ends).toBeLessThan(Date.now() + 7 * DAY + 5000);
      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Account limited",
      );
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      await waitFor(() => expect(transport.lift).toHaveBeenCalledWith("new-restriction"));
    });

    it("an admin's own words win over a preset, and the private note is sent", async () => {
      const { transport } = await open(false);
      await fireEvent.press(screen.getByTestId("limit-reason-spam"));
      await fireEvent.changeText(
        screen.getByTestId("limit-reason-input"),
        "  Same link five times  ",
      );
      await fireEvent.changeText(screen.getByTestId("limit-note-input"), "see report 12");
      await fireEvent.press(screen.getByTestId("limit-duration-h24"));
      await fireEvent.press(screen.getByTestId("limit-level-warning"));
      await fireEvent.press(screen.getByTestId("limit-submit"));
      await waitFor(() => expect(transport.restrict).toHaveBeenCalledTimes(1));
      expect(transport.restrict.mock.calls[0]?.[0]).toMatchObject({
        level: "warning",
        reason: "Same link five times",
        note: "see report 12",
      });
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Warning sent",
      );
    });

    it("suspends with no end date when 'Until lifted' is chosen", async () => {
      const { transport } = await open(true);
      await fireEvent.press(screen.getByTestId("limit-level-suspend"));
      await fireEvent.press(screen.getByTestId("limit-duration-open"));
      await fireEvent.press(screen.getByTestId("limit-reason-harassment"));
      await fireEvent.press(screen.getByTestId("limit-submit"));
      await waitFor(() => expect(transport.restrict).toHaveBeenCalledTimes(1));
      expect(transport.restrict.mock.calls[0]?.[0]).toMatchObject({
        level: "suspend",
        reason: "harassment",
        endsAt: null,
      });
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Account suspended",
      );
    });

    it("'until lifted' falls back to 7 days when the level changes away from suspend", async () => {
      const { transport } = await open(true);
      await fireEvent.press(screen.getByTestId("limit-level-suspend"));
      await fireEvent.press(screen.getByTestId("limit-duration-open"));
      await fireEvent.press(screen.getByTestId("limit-level-restrict"));
      await fireEvent.press(screen.getByTestId("limit-reason-spam"));
      await fireEvent.press(screen.getByTestId("limit-submit"));
      await waitFor(() => expect(transport.restrict).toHaveBeenCalledTimes(1));
      expect(transport.restrict.mock.calls[0]?.[0]?.endsAt).not.toBeNull();
    });

    it("a date of its own: refuses a bad or past date, accepts a future one as end of that day", async () => {
      const { transport } = await open(true);
      await fireEvent.press(screen.getByTestId("limit-duration-custom"));
      await fireEvent.press(screen.getByTestId("limit-reason-spam"));
      expect(screen.getByTestId("limit-submit").props.accessibilityState.disabled).toBe(
        true,
      );
      await fireEvent.changeText(screen.getByTestId("limit-date-input"), "2020-01-01");
      expect(screen.getByTestId("limit-date-error")).toHaveTextContent(
        "Enter a future date as YYYY-MM-DD.",
      );
      expect(screen.getByTestId("limit-submit").props.accessibilityState.disabled).toBe(
        true,
      );
      const future = new Date(Date.now() + 20 * DAY);
      const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
      await fireEvent.changeText(screen.getByTestId("limit-date-input"), ymd);
      expect(screen.queryByTestId("limit-date-error")).toBeNull();
      await fireEvent.press(screen.getByTestId("limit-submit"));
      await waitFor(() => expect(transport.restrict).toHaveBeenCalledTimes(1));
      const ends = new Date(transport.restrict.mock.calls[0]?.[0]?.endsAt as string);
      expect(ends.getFullYear()).toBe(future.getFullYear());
      expect(ends.getMonth()).toBe(future.getMonth());
      expect(ends.getDate()).toBe(future.getDate());
      expect(ends.getHours()).toBe(23);
    });

    it("keeps the sheet open and words the refusal, e.g. an admin account", async () => {
      const transport = fakeTransport();
      transport.restrict.mockRejectedValueOnce(new CommunityError("protected_account"));
      const { onClose } = await open(true, transport);
      await fireEvent.press(screen.getByTestId("limit-reason-spam"));
      await fireEvent.press(screen.getByTestId("limit-submit"));
      expect(await screen.findByTestId("limit-error")).toHaveTextContent(
        "This account can't be limited.",
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("snackbar")).toBeNull();
    });
  });

  it("reads in Arabic with the Arabic reasons", async () => {
    await i18n.changeLanguage("ar");
    await open(true);
    expect(screen.getByText("توقّع زلزال كاذب أو شائعة")).toBeTruthy();
    expect(screen.getByText("تعليق")).toBeTruthy();
  });
});

describe("parseEndDate", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");

  it("takes a real future day, in Latin or Eastern Arabic-Indic digits", () => {
    expect(parseEndDate("2026-11-30", now)).not.toBeNull();
    expect(parseEndDate("٢٠٢٦-١١-٣٠", now)).not.toBeNull();
    expect(parseEndDate("2026/11/30", now)).not.toBeNull();
  });

  it("refuses an impossible, past or too distant date", () => {
    expect(parseEndDate("2026-02-30", now)).toBeNull();
    expect(parseEndDate("2026-13-01", now)).toBeNull();
    expect(parseEndDate("2026-10-07", now)).toBeNull();
    expect(parseEndDate("2050-01-01", now)).toBeNull();
    expect(parseEndDate("tomorrow", now)).toBeNull();
    expect(parseEndDate("", now)).toBeNull();
  });
});
