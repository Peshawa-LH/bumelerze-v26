import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { ContentFilterContent } from "../components/ContentFilterContent";
import { makeFilterTransport, QUIET_SURGE } from "../__fixtures__/fake-filter";
import type { FilterTerm } from "../types";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "official-1" }),
}));

const STARTER: FilterTerm = {
  id: "t1",
  term: "quake tomorrow",
  lang: "en",
  kind: "prediction",
  isPattern: false,
  active: true,
  draft: true,
  holds30d: 3,
};
const OFF: FilterTerm = {
  id: "t2",
  term: "free followers",
  lang: "en",
  kind: "spam",
  isPattern: false,
  active: false,
  draft: false,
  holds30d: 0,
};

async function renderScreen(
  permissions: Permission[],
  filter = makeFilterTransport({ terms: [STARTER, OFF] }),
) {
  await renderWithProviders(
    <ContentFilterContent
      transport={filter}
      hubTransport={makeTransport({ permissions })}
    />,
  );
  return filter;
}

describe("Admin > Word filter and busy times", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("shows nothing but 'not allowed' without filter.manage, and asks the server nothing", async () => {
    const filter = await renderScreen(["comments.moderate"]);
    expect(await screen.findByTestId("filter-no-access")).toBeTruthy();
    expect(filter.fetchTerms).not.toHaveBeenCalled();
    expect(filter.fetchSurgeStatus).not.toHaveBeenCalled();
  });

  it("lists the terms with kind, language, starter and hit count", async () => {
    await renderScreen(["filter.manage"]);
    expect(await screen.findByText("quake tomorrow")).toBeTruthy();
    expect(
      screen.getByText(
        "Prediction or rumour · English · Starter: please review · Held 3 in 30 days",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Spam · English · Off")).toBeTruthy();
    expect(screen.getByTestId("filter-term-keep-t1")).toBeTruthy();
    expect(screen.queryByTestId("filter-term-keep-t2")).toBeNull();
  });

  it("keeps a starter term, switches a term off and on", async () => {
    const filter = await renderScreen(["filter.manage"]);
    await fireEvent.press(await screen.findByTestId("filter-term-keep-t1"));
    await waitFor(() => expect(filter.setTermActive).toHaveBeenCalledWith("t1", true));
    await fireEvent.press(screen.getByTestId("filter-term-toggle-t1"));
    await waitFor(() => expect(filter.setTermActive).toHaveBeenCalledWith("t1", false));
    await fireEvent.press(screen.getByTestId("filter-term-toggle-t2"));
    await waitFor(() => expect(filter.setTermActive).toHaveBeenCalledWith("t2", true));
  });

  it("adds a word with the chosen language and kind", async () => {
    const filter = await renderScreen(["filter.manage"]);
    await fireEvent.changeText(
      await screen.findByTestId("filter-add-input"),
      "  free iphone ",
    );
    await fireEvent.press(screen.getByTestId("filter-add-lang-en"));
    await fireEvent.press(screen.getByTestId("filter-add-kind-spam"));
    await fireEvent.press(screen.getByTestId("filter-add-submit"));
    await waitFor(() =>
      expect(filter.addTerm).toHaveBeenCalledWith("free iphone", "en", "spam"),
    );
    expect(await screen.findByTestId("filter-add-done")).toBeTruthy();
  });

  it("words the server's refusal of a bad term", async () => {
    const filter = makeFilterTransport();
    filter.addTerm.mockRejectedValueOnce(
      new Error("admin_add_filter_term: term_invalid"),
    );
    await renderScreen(["filter.manage"], filter);
    await fireEvent.changeText(await screen.findByTestId("filter-add-input"), "ab");
    await fireEvent.press(screen.getByTestId("filter-add-submit"));
    expect(await screen.findByText("Use 2 to 100 characters.")).toBeTruthy();
  });

  it("answers 'would this be held?' with the matched terms", async () => {
    const filter = makeFilterTransport({
      test: {
        held: true,
        matches: [
          { term: "quake tomorrow", kind: "prediction", lang: "en", isPattern: false },
        ],
        surge: false,
      },
    });
    await renderScreen(["filter.manage"], filter);
    await fireEvent.changeText(
      await screen.findByTestId("filter-test-input"),
      "Earthquake tomorrow!",
    );
    await fireEvent.press(screen.getByTestId("filter-test-run"));
    expect(filter.testText).toHaveBeenCalledWith("Earthquake tomorrow!");
    expect(await screen.findByText("It would wait for review.")).toBeTruthy();
    expect(
      screen.getByText("Matched: quake tomorrow (Prediction or rumour)"),
    ).toBeTruthy();
  });

  it("explains busy-time review, says why it is on, and switches it", async () => {
    const filter = makeFilterTransport({
      surge: {
        ...QUIET_SURGE,
        active: true,
        reason: "magnitude",
        magnitude: 5.2,
        place: "Halabja",
        until: Date.UTC(2026, 9, 10, 8, 0),
      },
    });
    await renderScreen(["filter.manage"], filter);
    expect(await screen.findByText(/On now: M 5\.2, Halabja\./)).toBeTruthy();
    expect(screen.getByText(/younger than 7 days wait for review/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("filter-surge-off"));
    await waitFor(() => expect(filter.setSurgeMode).toHaveBeenCalledWith("off"));
  });

  it("reads right to left in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await renderScreen(["filter.manage"]);
    expect(await screen.findByText(i18n.t("contentFilter.surge.title"))).toBeTruthy();
    expect(screen.getByText(i18n.t("contentFilter.add.title"))).toBeTruthy();
    expect(i18n.dir("ckb")).toBe("rtl");
  });
});
