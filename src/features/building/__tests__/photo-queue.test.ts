import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { HOME_PHOTO_MAX_COUNT } from "../constants";
import {
  enqueueHomePhotos,
  processHomePhotoQueue,
  useHomePhotoQueueStore,
} from "../photo-queue";
import { HomeError } from "../types";
import type { HomeTransport } from "../transport";
import { mockTransport, resetMockTransport } from "../__fixtures__/testing";

jest.mock("expo-crypto", () => ({
  randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}-0000`,
}));
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null,
  isSupabaseConfigured: () => true,
}));
const mockReadPhoto = jest.fn();
jest.mock("../photos", () => ({
  ...jest.requireActual("../photos"),
  readHomePhoto: (uri: string) => mockReadPhoto(uri),
}));

const transport = mockTransport as unknown as HomeTransport;
const items = () => useHomePhotoQueueStore.getState().items;

beforeEach(() => {
  useHomePhotoQueueStore.getState()._clear();
  resetMockTransport();
  mockReadPhoto.mockReset();
  mockReadPhoto.mockResolvedValue(new ArrayBuffer(4));
  mockTransport.savePhotoMeta.mockResolvedValue(undefined);
});

describe("enqueueHomePhotos", () => {
  it("writes every photo to the on-device queue with a fixed file name", () => {
    const queued = enqueueHomePhotos("tag-1", [
      { uri: "file://a.jpg", slot: "front", caption: "" },
      { uri: "file://b.jpg", slot: "more", caption: "crack" },
    ]);
    expect(queued).toBe(2);
    expect(items().map((item) => item.slot)).toEqual(["front", "more"]);
    expect(items()[0]?.fileName).toMatch(/^front-/);
    expect(items()[1]?.fileName).toMatch(/^more-/);
    expect(items()[0]?.fileName).not.toBe(items()[1]?.fileName);
    // a caption belongs to extras only
    expect(items()[0]?.caption).toBe("");
    expect(items()[1]?.caption).toBe("crack");
  });

  it("stops at 30 photos per home, counting what is already queued", () => {
    const many = Array.from({ length: 28 }, (_, i) => ({
      uri: `file://${i}.jpg`,
      slot: "more" as const,
      caption: "",
    }));
    expect(enqueueHomePhotos("tag-1", many)).toBe(28);
    expect(enqueueHomePhotos("tag-1", many)).toBe(HOME_PHOTO_MAX_COUNT - 28);
    expect(items().filter((item) => item.tagId === "tag-1")).toHaveLength(30);
    // another home has its own allowance
    expect(enqueueHomePhotos("tag-2", many.slice(0, 3))).toBe(3);
  });

  it("survives a restart: the queue is persisted on native", async () => {
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "roof", caption: "" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = await AsyncStorage.getItem("bumelerze.home.photoQueue");
    expect(stored).toContain("file://a.jpg");
    expect(stored).toContain('"tagId":"tag-1"');
  });

  it("on web, in-memory data: photos are not written to storage (quota)", async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    try {
      await AsyncStorage.removeItem("bumelerze.home.photoQueue");
      enqueueHomePhotos("tag-1", [
        { uri: "data:image/jpeg;base64,AAAA", slot: "front", caption: "" },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const stored = await AsyncStorage.getItem("bumelerze.home.photoQueue");
      expect(stored ?? "").not.toContain("data:image/jpeg");
      expect(items()).toHaveLength(1);
    } finally {
      Object.defineProperty(Platform, "OS", { value: original, configurable: true });
    }
  });
});

describe("processHomePhotoQueue", () => {
  it("uploads each photo, records its slot and caption, then removes it", async () => {
    enqueueHomePhotos("tag-1", [
      { uri: "file://a.jpg", slot: "front", caption: "" },
      { uri: "file://b.png", slot: "more", caption: "cracks" },
    ]);
    const uploaded = await processHomePhotoQueue({ transport });
    expect(uploaded).toBe(2);
    expect(items()).toHaveLength(0);
    expect(mockTransport.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(mockTransport.uploadPhoto.mock.calls[1]?.[0]).toMatchObject({
      tagId: "tag-1",
      contentType: "image/png",
    });
    expect(mockTransport.savePhotoMeta).toHaveBeenCalledWith({
      tagId: "tag-1",
      fileName: expect.stringMatching(/^more-/),
      slot: "more",
      caption: "cracks",
    });
  });

  it("a missing photo table (migration not applied) loses only the caption", async () => {
    mockTransport.savePhotoMeta.mockRejectedValue(new HomeError("unknown"));
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "front", caption: "" }]);
    expect(await processHomePhotoQueue({ transport })).toBe(1);
    expect(items()).toHaveLength(0);
  });

  it("weak network: the photo stays, backs off, and goes through when due", async () => {
    mockTransport.uploadPhoto.mockRejectedValueOnce(new HomeError("network"));
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "front", caption: "" }]);
    const t0 = 1_000_000;
    expect(await processHomePhotoQueue({ transport, now: t0 })).toBe(0);
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ attempts: 1, failures: 0 });
    expect(items()[0]?.nextRetryAt).toBeGreaterThan(Date.now());

    // not due yet: nothing is attempted
    mockTransport.uploadPhoto.mockClear();
    await processHomePhotoQueue({ transport, now: 1 });
    expect(mockTransport.uploadPhoto).not.toHaveBeenCalled();

    // a foreground trigger ignores the back-off
    expect(await processHomePhotoQueue({ transport, ignoreBackoff: true })).toBe(1);
    expect(items()).toHaveLength(0);
  });

  it("network trouble never drops a photo, however many times it fails", async () => {
    mockTransport.uploadPhoto.mockRejectedValue(new HomeError("network"));
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "front", caption: "" }]);
    for (let i = 0; i < 8; i += 1) {
      await processHomePhotoQueue({ transport, ignoreBackoff: true });
    }
    expect(items()).toHaveLength(1);
    expect(items()[0]?.attempts).toBe(8);
    expect(items()[0]?.failures).toBe(0);
  });

  it("a signed-out phone keeps the photos until the account is back", async () => {
    mockTransport.uploadPhoto.mockRejectedValue(new HomeError("need_account"));
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "front", caption: "" }]);
    for (let i = 0; i < 7; i += 1) {
      await processHomePhotoQueue({ transport, ignoreBackoff: true });
    }
    expect(items()).toHaveLength(1);
  });

  it("a photo the server keeps refusing is dropped after five tries", async () => {
    mockTransport.uploadPhoto.mockRejectedValue(new HomeError("unknown"));
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "front", caption: "" }]);
    for (let i = 0; i < 4; i += 1) {
      await processHomePhotoQueue({ transport, ignoreBackoff: true });
    }
    expect(items()).toHaveLength(1);
    await processHomePhotoQueue({ transport, ignoreBackoff: true });
    expect(items()).toHaveLength(0);
  });

  it("a photo over the 3 MB limit is dropped at once, the others still upload", async () => {
    mockReadPhoto.mockImplementation(async (uri: string) => {
      if (uri === "file://big.jpg") throw new HomeError("photo_too_large");
      return new ArrayBuffer(4);
    });
    enqueueHomePhotos("tag-1", [
      { uri: "file://big.jpg", slot: "front", caption: "" },
      { uri: "file://ok.jpg", slot: "back", caption: "" },
    ]);
    expect(await processHomePhotoQueue({ transport })).toBe(1);
    expect(items()).toHaveLength(0);
    expect(mockTransport.uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it("only one drain runs at a time", async () => {
    enqueueHomePhotos("tag-1", [{ uri: "file://a.jpg", slot: "front", caption: "" }]);
    let release: () => void = () => undefined;
    mockTransport.uploadPhoto.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const first = processHomePhotoQueue({ transport });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await processHomePhotoQueue({ transport })).toBe(0);
    release();
    expect(await first).toBe(1);
  });
});
