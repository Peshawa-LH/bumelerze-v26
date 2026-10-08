import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { assessAnswers } from "../assessment";
import type { Answers } from "../questionnaire";
import type { HomeTransport } from "../transport";
import type { HomeMember, HomeTag, StoredAssessment } from "../types";

/** A transport whose every method is a jest mock; screen tests mock
 * `../transport` so the real `SupabaseHomeTransport` export is this object. */
export type MockTransport = { [K in keyof HomeTransport]: jest.Mock };

export const mockTransport: MockTransport = {
  createTag: jest.fn(),
  requestJoin: jest.fn(),
  decideJoin: jest.fn(),
  leave: jest.fn(),
  removeMember: jest.fn(),
  restoreMember: jest.fn(),
  deleteHome: jest.fn(),
  trashHome: jest.fn(),
  restoreHome: jest.fn(),
  deleteHomeNow: jest.fn(),
  fetchTrashedHomes: jest.fn(),
  rotateKey: jest.fn(),
  fetchMemberships: jest.fn(),
  fetchTags: jest.fn(),
  fetchJoinKey: jest.fn(),
  fetchMembers: jest.fn(),
  fetchMemberProfiles: jest.fn(),
  fetchLatestAssessments: jest.fn(),
  fetchLatestSurvey: jest.fn(),
  saveSurvey: jest.fn(),
  saveAssessment: jest.fn(),
  uploadPhoto: jest.fn(),
  savePhotoMeta: jest.fn(),
  fetchPhotos: jest.fn(),
};

export function resetMockTransport(): void {
  for (const fn of Object.values(mockTransport)) {
    fn.mockReset();
  }
  mockTransport.fetchMemberships.mockResolvedValue([]);
  mockTransport.fetchTags.mockResolvedValue([]);
  mockTransport.fetchLatestAssessments.mockResolvedValue({});
  mockTransport.fetchMembers.mockResolvedValue([]);
  mockTransport.fetchMemberProfiles.mockResolvedValue({});
  mockTransport.fetchJoinKey.mockResolvedValue(null);
  mockTransport.fetchPhotos.mockResolvedValue([]);
  mockTransport.savePhotoMeta.mockResolvedValue(undefined);
  mockTransport.fetchLatestSurvey.mockResolvedValue(null);
  mockTransport.createTag.mockResolvedValue({
    tagId: "tag-1",
    code: "BMH-7K3Q9P",
    joinKey: "ABCD2345",
  });
  mockTransport.saveSurvey.mockResolvedValue("survey-1");
  mockTransport.saveAssessment.mockResolvedValue(undefined);
  mockTransport.uploadPhoto.mockResolvedValue(undefined);
  mockTransport.decideJoin.mockResolvedValue(undefined);
  mockTransport.leave.mockResolvedValue(undefined);
  mockTransport.removeMember.mockResolvedValue(undefined);
  mockTransport.restoreMember.mockResolvedValue(undefined);
  mockTransport.deleteHome.mockResolvedValue({ photosLeftBehind: false });
  mockTransport.trashHome.mockResolvedValue(undefined);
  mockTransport.restoreHome.mockResolvedValue(undefined);
  mockTransport.deleteHomeNow.mockResolvedValue(undefined);
  mockTransport.fetchTrashedHomes.mockResolvedValue([]);
  mockTransport.rotateKey.mockResolvedValue("NEWKEY99");
}

export const TAG: HomeTag = {
  tagId: "tag-1",
  code: "BMH-7K3Q9P",
  ownerUserId: "u-owner",
  kind: "house",
  label: "Our house",
  unitLabel: null,
  lat: 36.19,
  lon: 44.01,
  complexId: null,
  status: "active",
  createdAt: "2026-10-04T10:00:00Z",
};

export const ANSWERS: Answers = {
  floors: "f2",
  age: "a25_50",
  builder: "builder",
  structure: "block",
  belts: "dk",
  roof: "slab",
  added: "yes",
  cracks: "large",
};

/** A stored assessment built from the real method, as the database returns it. */
export function storedAssessment(
  answers: Answers = ANSWERS,
  overrides: Partial<StoredAssessment> = {},
): StoredAssessment {
  const result = assessAnswers(answers, { region: "kurdistan", settlement: "urban" });
  return {
    assessmentId: "as-1",
    tagId: "tag-1",
    surveyId: "survey-1",
    method: result.method,
    imsTypeProbs: result.ims_type_probs,
    vcProbs: result.vc_probs,
    vcMostLikely: result.vc_most_likely,
    vcRange: result.vc_range,
    confidence: result.confidence,
    hazard: { pga_g: 0.31, zone: "III", vs30: 405, site_class: "B", source: "ISC-2025" },
    reviewStatus: "automatic",
    createdAt: "2026-10-04T10:05:00Z",
    ...overrides,
  };
}

export function member(userId: string, overrides: Partial<HomeMember> = {}): HomeMember {
  return {
    tagId: "tag-1",
    userId,
    role: "member",
    status: "approved",
    requestedAt: "2026-10-04T10:00:00Z",
    ...overrides,
  };
}

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const clients: QueryClient[] = [];

/** The home hooks keep their data for five minutes (private data, short
 * cache); clearing the clients after each test frees those timers so Jest
 * can exit. */
export async function clearQueryClients(): Promise<void> {
  // Let in-flight fetches finish first: a fetch ending after `clear()` would
  // arm a fresh five-minute timer.
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const client of clients.splice(0)) {
    client.clear();
  }
}

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}
