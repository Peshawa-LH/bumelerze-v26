import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import i18n from "@/i18n";

import { FeedbackDetailContent } from "../components/FeedbackDetailContent";
import { FeedbackInboxContent } from "../components/FeedbackInboxContent";
import type { InboxTransport } from "../transport";
import type { FeedbackDetail, FeedbackRow } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));

const hub = makeTransport({ permissions: [] });
const ADMIN: Permission[] = [
  "feedback.manage",
  "badges.grant",
  "people.view",
  "people.view_guests",
  "accounts.restrict",
  "photos.moderate",
];

function row(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "f1",
    cursor: "2026-10-09T10:00:00Z",
    createdAt: Date.parse("2026-10-09T10:00:00Z"),
    status: "unseen",
    category: null,
    preview: "The map is slow on my phone",
    platform: "android",
    appVersion: "1.2.3",
    locale: "ckb",
    userId: "u1",
    displayName: "Aso",
    username: "aso",
    photoCount: 2,
    hasNote: false,
    ...overrides,
  };
}

function detail(overrides: Partial<FeedbackDetail> = {}): FeedbackDetail {
  return {
    id: "f1",
    createdAt: Date.parse("2026-10-09T10:00:00Z"),
    updatedAt: null,
    status: "unseen",
    category: null,
    message: "The map is slow on my phone",
    contact: "aso@example.org",
    platform: "android",
    appVersion: "1.2.3",
    locale: "ckb",
    triageNote: null,
    person: {
      userId: "u1",
      isAccount: true,
      displayName: "Aso",
      username: "aso",
      ranks: [],
    },
    photos: [{ id: "p1", storagePath: "u1/f1/p1.jpg" }],
    restriction: null,
    ...overrides,
  };
}

function fakeInbox(
  data: { rows?: FeedbackRow[]; detail?: FeedbackDetail } = {},
): jest.Mocked<InboxTransport> {
  return {
    list: jest.fn(async () => data.rows ?? [row()]),
    counts: jest.fn(async () => ({
      feedback: {
        unseen: 3,
        inReview: 1,
        solved: 0,
        wontDo: 0,
        badgeRequestsOpen: 2,
        appealsOpen: 1,
      },
      photosPending: 4,
    })),
    get: jest.fn(async () => data.detail ?? detail()),
    signScreenshots: jest.fn(async (paths: string[]) =>
      paths.map((p) => ({ path: p, url: `https://signed/${p}` })),
    ),
    setStatus: jest.fn(async () => undefined),
    grantBadge: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<InboxTransport>;
}

describe("Admin > Feedback", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows nothing but 'not allowed' without feedback.manage, and never asks the server", async () => {
    hub.fetchMyPermissions.mockResolvedValue(["comments.moderate", "photos.moderate"]);
    const inbox = fakeInbox();
    await renderWithProviders(
      <FeedbackInboxContent transport={inbox} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("inbox-no-access")).toBeTruthy();
    expect(inbox.list).not.toHaveBeenCalled();
    expect(inbox.counts).not.toHaveBeenCalled();
  });

  it("lists open messages first, with counts, and opens one", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox({
      rows: [
        row(),
        row({
          id: "f2",
          category: "badge_request",
          status: "in_review",
          hasNote: true,
          userId: null,
          displayName: null,
          username: null,
        }),
      ],
    });
    await renderWithProviders(
      <FeedbackInboxContent transport={inbox} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("inbox-row-f1")).toBeTruthy();
    expect(inbox.list).toHaveBeenCalledWith(
      { status: "open", category: null, search: "" },
      null,
    );
    expect(await screen.findByTestId("inbox-counts")).toHaveTextContent(
      "New: 3 · In review: 1 · Badge requests: 2 · Appeals: 1",
    );
    expect(screen.getByTestId("inbox-row-heading-f2")).toHaveTextContent(
      /In review · Badge request/,
    );
    expect(screen.getByText(/Sender unknown/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("inbox-row-f1"));
    expect(mockPush).toHaveBeenCalledWith("/admin/feedback/f1");
  });

  it("filters by status and kind", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox();
    await renderWithProviders(
      <FeedbackInboxContent transport={inbox} hubTransport={hub} />,
    );
    await screen.findByTestId("inbox-row-f1");
    await fireEvent.press(screen.getByTestId("inbox-status-solved"));
    await waitFor(() =>
      expect(inbox.list).toHaveBeenLastCalledWith(
        { status: "solved", category: null, search: "" },
        null,
      ),
    );
    await fireEvent.press(screen.getByTestId("inbox-category-appeal"));
    await waitFor(() =>
      expect(inbox.list).toHaveBeenLastCalledWith(
        { status: "solved", category: "appeal", search: "" },
        null,
      ),
    );
    await fireEvent.press(screen.getByTestId("inbox-status-all"));
    await waitFor(() =>
      expect(inbox.list).toHaveBeenLastCalledWith(
        { status: null, category: "appeal", search: "" },
        null,
      ),
    );
  });

  it("shows the empty state", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const empty = fakeInbox({ rows: [] });
    await renderWithProviders(
      <FeedbackInboxContent transport={empty} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("inbox-empty")).toBeTruthy();
  });

  it("shows the error state", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const broken = fakeInbox();
    broken.list.mockRejectedValue(new CommunityError("network", "x"));
    await renderWithProviders(
      <FeedbackInboxContent transport={broken} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("inbox-error")).toHaveTextContent(
      "No connection. Try again.",
    );
  });
});

describe("Admin > Feedback > message", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the message, contact, device, person link and screenshots", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox();
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("feedback-message")).toHaveTextContent(
      /The map is slow on my phone/,
    );
    expect(screen.getByTestId("feedback-contact")).toHaveTextContent(/aso@example\.org/);
    expect(screen.getByTestId("feedback-device")).toHaveTextContent(
      /Android · Version 1\.2\.3 · Language: ckb/,
    );
    expect(await screen.findByTestId("feedback-screenshot-0")).toBeTruthy();
    expect(inbox.signScreenshots).toHaveBeenCalledWith(["u1/f1/p1.jpg"]);
    await fireEvent.press(screen.getByTestId("feedback-open-person"));
    expect(mockPush).toHaveBeenCalledWith("/admin/person/u1");
    // not a badge request, not an appeal
    expect(screen.queryByTestId("feedback-badge")).toBeNull();
    expect(screen.queryByTestId("feedback-appeal")).toBeNull();
  });

  it("saves status and triage note, and only when something changed", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox();
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    const save = await screen.findByTestId("feedback-save");
    expect(save.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("feedback-status-in_review"));
    await fireEvent.changeText(
      screen.getByTestId("feedback-note-input"),
      "  Looking at it ",
    );
    await fireEvent.press(screen.getByTestId("feedback-save"));
    await waitFor(() =>
      expect(inbox.setStatus).toHaveBeenCalledWith("f1", "in_review", "Looking at it"),
    );
  });

  it("grants the requested badge in one tap, the rank read from the message", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox({
      detail: detail({
        category: "badge_request",
        message: "Badge request: Seismologist\nI teach at Salahaddin",
      }),
    });
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("feedback-badge")).toBeTruthy();
    expect(
      screen.getByTestId("feedback-rank-seismologist").props.accessibilityState.selected,
    ).toBe(true);
    await fireEvent.press(screen.getByTestId("feedback-grant"));
    await waitFor(() =>
      expect(inbox.grantBadge).toHaveBeenCalledWith("f1", "seismologist", null),
    );
  });

  it("asks for the organisation of a partner and sends it", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox({
      detail: detail({ category: "badge_request", message: "please" }),
    });
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    const grant = await screen.findByTestId("feedback-grant");
    expect(grant.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("feedback-rank-partner"));
    await fireEvent.changeText(
      screen.getByTestId("feedback-org-input"),
      " KRG Civil Defence ",
    );
    await fireEvent.press(screen.getByTestId("feedback-grant"));
    await waitFor(() =>
      expect(inbox.grantBadge).toHaveBeenCalledWith("f1", "partner", "KRG Civil Defence"),
    );
  });

  it("explains why a guest cannot get a badge", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const guest = fakeInbox({
      detail: detail({
        category: "badge_request",
        person: {
          userId: "g1",
          isAccount: false,
          displayName: null,
          username: null,
          ranks: [],
        },
      }),
    });
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={guest} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("feedback-badge-guest")).toBeTruthy();
    expect(screen.queryByTestId("feedback-grant")).toBeNull();
  });

  it("explains why a person without @username cannot get a badge", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const noName = fakeInbox({
      detail: detail({
        category: "badge_request",
        person: {
          userId: "u2",
          isAccount: true,
          displayName: "Bana",
          username: null,
          ranks: [],
        },
      }),
    });
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={noName} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("feedback-badge-no-username")).toBeTruthy();
  });

  it("hides the grant without badges.grant", async () => {
    hub.fetchMyPermissions.mockResolvedValue(["feedback.manage"]);
    const inbox = fakeInbox({
      detail: detail({ category: "badge_request", message: "Badge request: Engineer" }),
    });
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    await screen.findByTestId("feedback-message");
    expect(screen.queryByTestId("feedback-badge")).toBeNull();
    expect(screen.queryByTestId("feedback-open-person")).toBeNull();
  });

  it("an appeal shows its restriction and links to Limited accounts", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox({
      detail: detail({
        category: "appeal",
        message: "Review request for restriction r1 (restrict): spam",
        restriction: {
          id: "r1",
          level: "restrict",
          reason: "spam",
          endsAt: Date.parse("2026-10-12T00:00:00Z"),
          liftedAt: null,
          active: true,
        },
      }),
    });
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("feedback-appeal-restriction")).toHaveTextContent(
      /Until/,
    );
    await fireEvent.press(screen.getByTestId("feedback-open-limited"));
    expect(mockPush).toHaveBeenCalledWith("/admin/limited");
  });

  it("shows the server's reason when a grant fails", async () => {
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    const inbox = fakeInbox({
      detail: detail({ category: "badge_request", message: "Badge request: Engineer" }),
    });
    inbox.grantBadge.mockRejectedValue(
      new CommunityError("not_found", "admin_feedback_grant_badge: no_username"),
    );
    await renderWithProviders(
      <FeedbackDetailContent feedbackId="f1" transport={inbox} hubTransport={hub} />,
    );
    await fireEvent.press(await screen.findByTestId("feedback-grant"));
    expect(await screen.findByTestId("feedback-action-error")).toHaveTextContent(
      /no @username/,
    );
  });

  it("renders right to left in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    hub.fetchMyPermissions.mockResolvedValue(ADMIN);
    await renderWithProviders(
      <FeedbackDetailContent
        feedbackId="f1"
        transport={fakeInbox()}
        hubTransport={hub}
      />,
    );
    expect(await screen.findByTestId("feedback-heading")).toHaveTextContent(/نوێ/);
    expect(screen.getByText("پاشەکەوت")).toBeTruthy();
  });
});
