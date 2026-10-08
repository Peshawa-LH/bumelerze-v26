import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import i18n from "@/i18n";

import { FeltPhotoQueueContent } from "../components/FeltPhotoQueueContent";
import {
  parseModerateResult,
  parseQueuePhotos,
  type PhotoQueueTransport,
  type QueuePhoto,
} from "../transport";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "mod-1" }),
}));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: { onConfirm: () => void }) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const hub = makeTransport({ permissions: [] });
const MODERATOR: Permission[] = ["comments.moderate", "photos.moderate"];

function photo(overrides: Partial<QueuePhoto> = {}): QueuePhoto {
  return {
    id: "p1",
    storagePath: "u1/r1.jpg",
    status: "pending",
    cursor: "2026-10-09T10:00:00Z",
    createdAt: Date.parse("2026-10-09T10:00:00Z"),
    reportedAt: Date.parse("2026-10-09T09:58:00Z"),
    intensity: 5,
    hubId: "bml2026bb",
    place: "Hawler",
    magnitude: 5,
    originTime: Date.parse("2026-10-09T09:55:00Z"),
    moderatedAt: null,
    moderatedByName: null,
    ...overrides,
  };
}

function fakePhotos(rows: QueuePhoto[] = [photo()]): jest.Mocked<PhotoQueueTransport> {
  return {
    queue: jest.fn(async () => rows),
    sign: jest.fn(async (paths: string[]) =>
      paths.map((p) => ({ path: p, url: `https://signed/${p}` })),
    ),
    moderate: jest.fn(async (id: string, action: "approve" | "reject") => ({
      status: action === "approve" ? ("approved" as const) : ("rejected" as const),
      storagePath: "u1/r1.jpg",
    })),
    removeFile: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<PhotoQueueTransport>;
}

describe("parsers", () => {
  it("parses queue rows and never invents a location", () => {
    const rows = parseQueuePhotos([
      {
        photo_id: "p1",
        storage_path: "u1/r1.jpg",
        status: "rejected",
        created_at: "2026-10-09T10:00:00Z",
        report_created_at: "2026-10-09T09:58:00Z",
        intensity: 6,
        hub_id: "bml2026bb",
        place: "Hawler",
        magnitude: 5.04,
        origin_time: "2026-10-09T09:55:00Z",
        moderated_at: "2026-10-09T11:00:00Z",
        moderated_by_name: "Mona",
        lat: 36.1,
      },
      { photo_id: "broken" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "p1",
      status: "rejected",
      intensity: 6,
      cursor: "2026-10-09T11:00:00Z",
    });
    expect(Object.keys(rows[0] as object)).not.toContain("lat");
    expect(parseModerateResult({ status: "approved", storage_path: "a" })).toEqual({
      status: "approved",
      storagePath: "a",
    });
    expect(() => parseModerateResult(null)).toThrow();
  });
});

describe("Admin > Felt photos", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockConfirm.mockReset();
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows nothing without photos.moderate and never asks the server", async () => {
    hub.fetchMyPermissions.mockResolvedValue(["comments.moderate"]);
    const t = fakePhotos();
    await renderWithProviders(<FeltPhotoQueueContent transport={t} hubTransport={hub} />);
    expect(await screen.findByTestId("photos-no-access")).toBeTruthy();
    expect(t.queue).not.toHaveBeenCalled();
  });

  it("shows a waiting photo with its earthquake and intensity, and no location", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    const t = fakePhotos();
    await renderWithProviders(<FeltPhotoQueueContent transport={t} hubTransport={hub} />);
    expect(await screen.findByTestId("photo-image-p1")).toBeTruthy();
    expect(t.queue).toHaveBeenCalledWith("pending", null);
    expect(t.sign).toHaveBeenCalledWith(["u1/r1.jpg"]);
    expect(screen.getByTestId("photo-event-p1")).toHaveTextContent(/Hawler/);
    expect(screen.getByTestId("photo-report-p1")).toHaveTextContent(/Felt: V/);
    expect(screen.queryByText(/36\.|44\./)).toBeNull();
    await fireEvent.press(screen.getByTestId("photo-open-p1"));
    expect(mockPush).toHaveBeenCalledWith("/event-hub/bml2026bb");
  });

  it("approves", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    const t = fakePhotos();
    await renderWithProviders(<FeltPhotoQueueContent transport={t} hubTransport={hub} />);
    await fireEvent.press(await screen.findByTestId("photo-approve-p1"));
    await waitFor(() => expect(t.moderate).toHaveBeenCalledWith("p1", "approve", null));
    expect(t.removeFile).not.toHaveBeenCalled();
  });

  it("rejects only after confirming, then deletes the file", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    const t = fakePhotos();
    await renderWithProviders(<FeltPhotoQueueContent transport={t} hubTransport={hub} />);
    await fireEvent.press(await screen.findByTestId("photo-reject-p1"));
    expect(t.moderate).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true }),
    );
    mockConfirm.mock.calls[0][0].onConfirm();
    await waitFor(() => expect(t.removeFile).toHaveBeenCalledWith("u1/r1.jpg"));
    expect(t.moderate).toHaveBeenCalledWith("p1", "reject", null);
  });

  it("says so when the decision is saved but the file stays", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    const t = fakePhotos();
    t.removeFile.mockRejectedValue(new CommunityError("network", "x"));
    await renderWithProviders(<FeltPhotoQueueContent transport={t} hubTransport={hub} />);
    await fireEvent.press(await screen.findByTestId("photo-reject-p1"));
    mockConfirm.mock.calls[0][0].onConfirm();
    expect(await screen.findByTestId("photo-error-p1")).toHaveTextContent(
      /could not be deleted yet/,
    );
  });

  it("a rejected photo whose file is gone offers nothing; one whose file stayed offers to delete it", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    const t = fakePhotos([
      photo({
        id: "gone",
        status: "rejected",
        storagePath: "u1/gone.jpg",
        moderatedAt: 1,
        moderatedByName: "Mona",
      }),
      photo({
        id: "kept",
        status: "rejected",
        storagePath: "u1/kept.jpg",
        moderatedAt: 1,
        moderatedByName: null,
      }),
    ]);
    t.sign.mockResolvedValue([{ path: "u1/kept.jpg", url: "https://signed/kept" }]);
    await renderWithProviders(<FeltPhotoQueueContent transport={t} hubTransport={hub} />);
    await fireEvent.press(await screen.findByTestId("photos-tab-rejected"));
    await waitFor(() => expect(t.queue).toHaveBeenCalledWith("rejected", null));
    expect(await screen.findByTestId("photo-no-image-gone")).toHaveTextContent(
      "File deleted",
    );
    expect(screen.queryByTestId("photo-reject-gone")).toBeNull();
    expect(screen.queryByTestId("photo-remove-file-gone")).toBeNull();
    expect(await screen.findByTestId("photo-remove-file-kept")).toBeTruthy();
    expect(screen.queryByTestId("photo-approve-kept")).toBeNull();
  });

  it("shows the empty state per tab", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    await renderWithProviders(
      <FeltPhotoQueueContent transport={fakePhotos([])} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("photos-empty")).toHaveTextContent(
      "No photos waiting.",
    );
  });

  it("reads right to left in Arabic", async () => {
    await i18n.changeLanguage("ar");
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    await renderWithProviders(
      <FeltPhotoQueueContent transport={fakePhotos()} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("photo-approve-p1")).toHaveTextContent("موافقة");
  });
});
