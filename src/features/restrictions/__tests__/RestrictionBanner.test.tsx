import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { RestrictionBanner } from "../components/RestrictionBanner";
import { DAY, fakeTransport, mine } from "../__fixtures__/testing";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "me",
};
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

describe("RestrictionBanner", () => {
  beforeEach(async () => {
    mockAccount = { status: "account", userId: "me" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows nothing for a person with no limit", async () => {
    await renderWithProviders(<RestrictionBanner transport={fakeTransport()} />);
    await act(async () => undefined);
    expect(screen.queryByTestId("restriction-banner")).toBeNull();
  });

  it("says, calmly, until when and why the account is limited, and what still works", async () => {
    await renderWithProviders(
      <RestrictionBanner transport={fakeTransport({ mine: mine() })} />,
    );
    const message = await screen.findByTestId("restriction-banner-message");
    const text = String(
      Array.isArray(message.props.children)
        ? message.props.children.join("")
        : message.props.children,
    );
    expect(text).toMatch(
      /^Your account is limited until .+: Fake earthquake prediction or rumour$/,
    );
    expect(screen.getByTestId("restriction-banner-detail")).toHaveTextContent(
      /felt reports and get alerts/,
    );
    // calm, not alarming: an alert role would interrupt, a polite live region does not
    expect(screen.getByTestId("restriction-banner").props.accessibilityLiveRegion).toBe(
      "polite",
    );
    expect(screen.getByTestId("restriction-banner").props.accessibilityRole).not.toBe(
      "alert",
    );
  });

  it("words a suspension without an end date", async () => {
    await renderWithProviders(
      <RestrictionBanner
        transport={fakeTransport({ mine: mine({ level: "suspend", endsAt: null }) })}
      />,
    );
    expect(await screen.findByTestId("restriction-banner-message")).toHaveTextContent(
      "Your account is suspended: Fake earthquake prediction or rumour",
    );
    expect(screen.getByTestId("restriction-banner-detail")).toHaveTextContent(
      /others can't see your profile/,
    );
  });

  it("words a suspension that ends on a date", async () => {
    await renderWithProviders(
      <RestrictionBanner
        transport={fakeTransport({ mine: mine({ level: "suspend" }) })}
      />,
    );
    expect(await screen.findByTestId("restriction-banner-message")).toHaveTextContent(
      /^Your account is suspended until /,
    );
  });

  it("a warning is only a notice: no 'cannot write' line", async () => {
    await renderWithProviders(
      <RestrictionBanner
        transport={fakeTransport({
          mine: mine({ level: "warning", reason: "heads up" }),
        })}
      />,
    );
    expect(await screen.findByTestId("restriction-banner-message")).toHaveTextContent(
      "You have a warning: heads up",
    );
    expect(screen.queryByTestId("restriction-banner-detail")).toBeNull();
  });

  it("shows an admin's own words as written", async () => {
    await renderWithProviders(
      <RestrictionBanner
        transport={fakeTransport({
          mine: mine({ reason: "Please stop posting the same link" }),
        })}
      />,
    );
    expect(await screen.findByTestId("restriction-banner-message")).toHaveTextContent(
      /: Please stop posting the same link$/,
    );
  });

  it("stays away once the end date has passed", async () => {
    await renderWithProviders(
      <RestrictionBanner
        transport={fakeTransport({ mine: mine({ endsAt: Date.now() - 1000 }) })}
      />,
    );
    await act(async () => undefined);
    expect(screen.queryByTestId("restriction-banner")).toBeNull();
  });

  it("also shows for a guest identity", async () => {
    mockAccount = { status: "anonymous", userId: "guest-1" };
    await renderWithProviders(
      <RestrictionBanner transport={fakeTransport({ mine: mine() })} />,
    );
    expect(await screen.findByTestId("restriction-banner")).toBeTruthy();
  });

  it("reads in Sorani with the Kurdish reason", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(
      <RestrictionBanner
        transport={fakeTransport({ mine: mine({ reason: "harassment" }) })}
      />,
    );
    expect(await screen.findByTestId("restriction-banner-message")).toHaveTextContent(
      /^هەژمارەکەت تا .+ سنووردارکراوە: ئازاردان$/,
    );
    expect(screen.getByText("داواکردنی پێداچوونەوە")).toBeTruthy();
  });

  describe("Ask for review", () => {
    it("opens a sheet, sends the optional message and then reads 'Review requested'", async () => {
      const transport = fakeTransport({ mine: mine() });
      await renderWithProviders(<RestrictionBanner transport={transport} />);
      await fireEvent.press(await screen.findByTestId("restriction-ask"));
      expect(await screen.findByTestId("review-sheet")).toBeTruthy();
      await fireEvent.changeText(
        screen.getByTestId("review-sheet-input"),
        "  I did not post that  ",
      );
      await fireEvent.press(screen.getByTestId("review-sheet-send"));
      await waitFor(() =>
        expect(transport.requestReview).toHaveBeenCalledWith("r1", "I did not post that"),
      );
      await waitFor(() => expect(screen.queryByTestId("review-sheet")).toBeNull());
      expect(screen.getByTestId("restriction-requested")).toHaveTextContent(
        "Review requested",
      );
      expect(screen.queryByTestId("restriction-ask")).toBeNull();
    });

    it("lets the person send it without any message", async () => {
      const transport = fakeTransport({ mine: mine() });
      await renderWithProviders(<RestrictionBanner transport={transport} />);
      await fireEvent.press(await screen.findByTestId("restriction-ask"));
      await fireEvent.press(await screen.findByTestId("review-sheet-send"));
      await waitFor(() => expect(transport.requestReview).toHaveBeenCalledWith("r1", ""));
    });

    it("keeps the sheet and the typed words when sending fails", async () => {
      const transport = fakeTransport({ mine: mine() });
      transport.requestReview.mockRejectedValueOnce(new CommunityError("network"));
      await renderWithProviders(<RestrictionBanner transport={transport} />);
      await fireEvent.press(await screen.findByTestId("restriction-ask"));
      await fireEvent.changeText(screen.getByTestId("review-sheet-input"), "please look");
      await fireEvent.press(screen.getByTestId("review-sheet-send"));
      expect(await screen.findByTestId("review-sheet-error")).toHaveTextContent(
        "No connection. Try again.",
      );
      expect(screen.getByTestId("review-sheet-input").props.value).toBe("please look");
    });

    it("shows 'Review requested' at once when a review was already asked for", async () => {
      await renderWithProviders(
        <RestrictionBanner
          transport={fakeTransport({
            mine: mine({ appealRequestedAt: Date.now() - DAY / 2 }),
          })}
        />,
      );
      expect(await screen.findByTestId("restriction-requested")).toBeTruthy();
      expect(screen.queryByTestId("restriction-ask")).toBeNull();
    });
  });
});
