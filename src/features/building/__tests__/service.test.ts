import {
  createHomeFromDraft,
  saveSurveyAndAssessment,
  surveyPayload,
  answersFromSurvey,
  type TagDraft,
} from "../service";
import { QUESTIONNAIRE_VERSION } from "../questionnaire";
import { HomeError } from "../types";
import { ANSWERS, mockTransport, resetMockTransport } from "../__fixtures__/testing";
import type { HomeTransport } from "../transport";
import { useHomePhotoQueueStore } from "../photo-queue";

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null,
  isSupabaseConfigured: () => true,
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}-0000`,
}));

const mockReadPhoto = jest.fn();
jest.mock("../photos", () => ({
  ...jest.requireActual("../photos"),
  readHomePhoto: (uri: string) => mockReadPhoto(uri),
}));

const transport = mockTransport as unknown as HomeTransport;

const DRAFT: TagDraft = {
  kind: "apartment",
  label: "  Flat  ",
  unitLabel: " 3/7 ",
  lat: 36.19,
  lon: 44.01,
  locationQuality: "gps",
  answers: ANSWERS,
  photos: [],
};

async function waitFor(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  useHomePhotoQueueStore.getState()._clear();
  resetMockTransport();
  mockReadPhoto.mockReset();
  mockReadPhoto.mockResolvedValue(new ArrayBuffer(4));
});

describe("surveyPayload", () => {
  it("keeps the answers and adds how exact the point was", () => {
    expect(surveyPayload({ floors: "f2" }, "town")).toEqual({
      floors: "f2",
      location_quality: "town",
    });
    expect(surveyPayload({ floors: "f2" })).toEqual({ floors: "f2" });
  });

  it("drops answers to questions that no longer apply", () => {
    expect(surveyPayload({ structure: "frame", belts: "yes" })).toEqual({
      structure: "frame",
    });
  });

  it("reads stored answers back, ignoring anything unknown", () => {
    expect(
      answersFromSurvey({
        floors: "f2",
        bogus: "x",
        structure: "nope",
        location_quality: "gps",
      }),
    ).toEqual({
      floors: "f2",
    });
    expect(answersFromSurvey(null)).toEqual({});
  });
});

describe("saveSurveyAndAssessment", () => {
  it("stores the survey, then the assessment computed at the tag's point", async () => {
    const assessment = await saveSurveyAndAssessment(
      "tag-1",
      { lat: 36.19, lon: 44.01 },
      ANSWERS,
      {
        transport,
        locationQuality: "gps",
      },
    );
    expect(mockTransport.saveSurvey).toHaveBeenCalledWith({
      tagId: "tag-1",
      version: QUESTIONNAIRE_VERSION,
      answers: { ...ANSWERS, location_quality: "gps" },
    });
    expect(mockTransport.saveAssessment).toHaveBeenCalledWith({
      tagId: "tag-1",
      surveyId: "survey-1",
      assessment,
    });
    expect(assessment.method).toBe("auto-v0");
    expect(assessment.hazard.pga_g).not.toBeNull();
    // saved after the survey, never before
    expect(mockTransport.saveSurvey.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransport.saveAssessment.mock.invocationCallOrder[0] as number,
    );
  });
});

describe("createHomeFromDraft", () => {
  it("creates the tag, saves the survey and assessment, and trims the labels", async () => {
    const created: string[] = [];
    const outcome = await createHomeFromDraft(DRAFT, {
      transport,
      onTagCreated: (id) => created.push(id),
    });
    expect(mockTransport.createTag).toHaveBeenCalledWith({
      kind: "apartment",
      lat: 36.19,
      lon: 44.01,
      label: "Flat",
      unitLabel: "3/7",
    });
    expect(created).toEqual(["tag-1"]);
    expect(outcome.tagId).toBe("tag-1");
    expect(outcome.photosQueued).toBe(0);
    expect(mockTransport.saveAssessment).toHaveBeenCalledTimes(1);
  });

  it("a house has no unit label and an empty name is null", async () => {
    await createHomeFromDraft(
      { ...DRAFT, kind: "house", label: " ", unitLabel: "3/7" },
      { transport },
    );
    expect(mockTransport.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "house", label: null, unitLabel: null }),
    );
  });

  it("resumes with the same tag after a failure instead of creating a second home", async () => {
    mockTransport.saveSurvey.mockRejectedValueOnce(new HomeError("network"));
    let tagId: string | null = null;
    await expect(
      createHomeFromDraft(DRAFT, { transport, onTagCreated: (id) => (tagId = id) }),
    ).rejects.toMatchObject({ code: "network" });
    expect(tagId).toBe("tag-1");
    await createHomeFromDraft(DRAFT, { transport, existingTagId: tagId });
    expect(mockTransport.createTag).toHaveBeenCalledTimes(1);
    expect(mockTransport.saveSurvey).toHaveBeenCalledTimes(2);
    expect(mockTransport.saveAssessment).toHaveBeenCalledTimes(1);
  });

  it("queues the photos after the report is saved and uploads them in the background", async () => {
    const outcome = await createHomeFromDraft(
      {
        ...DRAFT,
        photos: [
          { uri: "file://a.jpg", slot: "front", caption: "" },
          { uri: "file://b.png", slot: "more", caption: "crack by the door" },
        ],
      },
      { transport },
    );
    expect(outcome.photosQueued).toBe(2);
    await waitFor(() => mockTransport.savePhotoMeta.mock.calls.length === 2);
    expect(mockTransport.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(mockTransport.saveAssessment.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransport.uploadPhoto.mock.invocationCallOrder[0] as number,
    );
    const [first, second] = mockTransport.uploadPhoto.mock.calls.map((call) => call[0]);
    expect(first.tagId).toBe("tag-1");
    expect(first.fileName).toMatch(/^front-\d+[0-9a-z-]+\.jpg$/);
    expect(second.fileName).toMatch(/^more-/);
    expect(first.contentType).toBe("image/jpeg");
    expect(second.contentType).toBe("image/png");
    expect(mockTransport.savePhotoMeta).toHaveBeenCalledWith(
      expect.objectContaining({ slot: "more", caption: "crack by the door" }),
    );
    expect(useHomePhotoQueueStore.getState().items).toHaveLength(0);
  });

  it("a photo that cannot upload never fails the home; it stays queued for later", async () => {
    mockTransport.uploadPhoto.mockRejectedValue(new HomeError("network"));
    const outcome = await createHomeFromDraft(
      { ...DRAFT, photos: [{ uri: "file://a.jpg", slot: "front", caption: "" }] },
      { transport },
    );
    expect(outcome.tagId).toBe("tag-1");
    expect(outcome.photosQueued).toBe(1);
    await waitFor(() => mockTransport.uploadPhoto.mock.calls.length === 1);
    await waitFor(() => useHomePhotoQueueStore.getState().items[0]?.attempts === 1);
    expect(useHomePhotoQueueStore.getState().items).toHaveLength(1);
  });
});
