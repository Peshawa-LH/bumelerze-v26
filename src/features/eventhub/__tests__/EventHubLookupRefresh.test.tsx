/**
 * The hub after a failed registry lookup. The hub (and its pill and the
 * felt map on the event page) is keyed by the event's registry id; when the
 * lookup failed (offline), pulling the hub down to refresh re-read the hub
 * but never asked for the id again, so everything stayed missing until a
 * restart (2026-10-22). The real lookup hook is used; only the registry
 * call is mocked.
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";

import { EventHubContent } from "../components/EventHubContent";
import { buildEvent, makeTransport, renderWithProviders } from "../__fixtures__/testing";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

const mockLookUp = jest.fn();
jest.mock("@/features/shakemap/live-transport", () => ({
  lookUpEventUuidForEvent: (event: unknown) => mockLookUp(event),
}));

jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => ({ status: "anonymous", userId: "anon-1" }),
}));

const REGISTRY_ID = "uuid-1";
/** The lookup retries once, a second later. */
const AFTER_RETRY = { timeout: 4000 };

function hubEvent(providerId: string) {
  return buildEvent({
    id: providerId,
    provenance: {
      provider: "usgs",
      providerId,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
  });
}

async function pullToRefresh(): Promise<void> {
  const list = screen.getByTestId("hub-list");
  await act(async () => {
    list.props.refreshControl.props.onRefresh();
  });
}

describe("EventHubContent after a failed registry lookup", () => {
  beforeEach(async () => {
    mockLookUp.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("asks for the id again when pulled to refresh, and the hub loads", async () => {
    const transport = makeTransport();
    mockLookUp.mockRejectedValue(new TypeError("Network request failed"));
    await renderWithProviders(
      <EventHubContent event={hubEvent("us_hub_offline")} transport={transport} />,
    );
    expect(
      await screen.findByText("Not available right now.", {}, AFTER_RETRY),
    ).toBeTruthy();
    const askedBefore = mockLookUp.mock.calls.length;

    mockLookUp.mockResolvedValue(REGISTRY_ID);
    await pullToRefresh();

    await waitFor(() =>
      expect(mockLookUp.mock.calls.length).toBeGreaterThan(askedBefore),
    );
    expect(
      await screen.findByText("No comments yet. Be the first to share what you felt."),
    ).toBeTruthy();
    expect(transport.fetchSummary).toHaveBeenCalledWith(REGISTRY_ID);
    expect(transport.fetchComments).toHaveBeenCalledWith(REGISTRY_ID);
  });

  it("never reads the hub without an id while it asks again", async () => {
    const transport = makeTransport();
    mockLookUp.mockRejectedValue(new TypeError("Network request failed"));
    await renderWithProviders(
      <EventHubContent event={hubEvent("us_hub_no_id_reads")} transport={transport} />,
    );
    await screen.findByText("Not available right now.", {}, AFTER_RETRY);

    await pullToRefresh();
    await waitFor(() => expect(mockLookUp.mock.calls.length).toBeGreaterThan(2));

    expect(transport.fetchSummary).not.toHaveBeenCalled();
    expect(transport.fetchComments).not.toHaveBeenCalled();
  });

  // The web has no pull-to-refresh (react-native-web's RefreshControl draws
  // nothing), so the note itself offers the same refresh.
  it("offers Retry under 'Not available right now.', which asks again", async () => {
    const transport = makeTransport();
    mockLookUp.mockRejectedValue(new TypeError("Network request failed"));
    await renderWithProviders(
      <EventHubContent event={hubEvent("us_hub_retry")} transport={transport} />,
    );
    await screen.findByText("Not available right now.", {}, AFTER_RETRY);

    mockLookUp.mockResolvedValue(REGISTRY_ID);
    await fireEvent.press(screen.getByTestId("hub-unavailable-retry"));

    expect(
      await screen.findByText("No comments yet. Be the first to share what you felt."),
    ).toBeTruthy();
    expect(screen.queryByTestId("hub-unavailable-retry")).toBeNull();
  });

  it("gives that Retry a 44 pt target in real layout, and reads in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    mockLookUp.mockRejectedValue(new TypeError("Network request failed"));
    await renderWithProviders(
      <EventHubContent
        event={hubEvent("us_hub_retry_ckb")}
        transport={makeTransport()}
      />,
    );

    const retry = await screen.findByTestId("hub-unavailable-retry", {}, AFTER_RETRY);
    const style = Array.isArray(retry.props.style)
      ? Object.assign({}, ...retry.props.style)
      : retry.props.style;
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(screen.getByRole("button", { name: i18n.t("events.retry") })).toBe(retry);
  });

  it("keeps a known id: a refresh re-reads the hub without asking for it again", async () => {
    const transport = makeTransport();
    mockLookUp.mockResolvedValue(REGISTRY_ID);
    await renderWithProviders(
      <EventHubContent event={hubEvent("us_hub_known")} transport={transport} />,
    );
    await screen.findByText("No comments yet. Be the first to share what you felt.");
    const readsBefore = transport.fetchComments.mock.calls.length;

    await pullToRefresh();

    await waitFor(() =>
      expect(transport.fetchComments.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(mockLookUp).toHaveBeenCalledTimes(1);
  });
});
