import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { Event } from "@/features/events";

import type { EventHubTransport } from "../transport";
import type { HubComment, HubRole, HubSummary, Permission } from "../types";

/** Shared fixtures for the Event hub component tests. */

export function buildEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "hub-event-1",
    bumelerzeId: "bml20260042",
    originTime: Date.now() - 5 * 60_000,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.2, type: "mb" },
    placeName: "Slemani, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "hub-event-1",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 420,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

export function buildComment(
  overrides: Partial<HubComment> & { id: string },
): HubComment {
  return {
    eventId: "uuid-1",
    parentId: null,
    userId: "u-other",
    body: "Felt it",
    areaGeohash: null,
    status: "visible",
    helpfulCount: 0,
    replyCount: 0,
    createdAt: Date.now() - 5 * 60_000,
    ...overrides,
  };
}

export const EMPTY_SUMMARY: HubSummary = {
  reports: 0,
  people: 0,
  levels: {},
  firstReportAt: null,
  comments: 0,
};

export interface FakeTransportData {
  summary?: HubSummary | null;
  comments?: HubComment[];
  authors?: Record<
    string,
    { displayName: string; avatarPath?: string | null; username?: string | null }
  >;
  roles?: Record<string, HubRole[]>;
  helped?: string[];
  /** The viewer's `my_permissions()`. Left out = the function is missing
   * (a server without migration 0043), so the hub falls back to roles. */
  permissions?: Permission[];
  /** People the viewer follows. */
  following?: string[];
  /** Comment ids the viewer reported and has not withdrawn. */
  flagged?: string[];
}

export type FakeTransport = {
  [K in keyof EventHubTransport]: jest.MockedFunction<EventHubTransport[K]>;
};

/** A jest-mock-backed transport; every method is a `jest.fn` to assert on. */
export function makeTransport(
  data: FakeTransportData = {},
  overrides: Partial<EventHubTransport> = {},
): FakeTransport {
  const transport = {
    fetchSummary: jest.fn(async () => data.summary ?? EMPTY_SUMMARY),
    fetchComments: jest.fn(async () => data.comments ?? []),
    fetchAuthors: jest.fn(async (ids: readonly string[]) =>
      Object.fromEntries(
        ids
          .filter((id) => data.authors?.[id])
          .map((id) => [
            id,
            {
              userId: id,
              displayName: data.authors?.[id]?.displayName ?? "",
              avatarPath: data.authors?.[id]?.avatarPath ?? null,
              username: data.authors?.[id]?.username ?? null,
            },
          ]),
      ),
    ),
    fetchRoles: jest.fn(async (ids: readonly string[]) =>
      Object.fromEntries(
        ids.filter((id) => data.roles?.[id]).map((id) => [id, data.roles?.[id] ?? []]),
      ),
    ),
    fetchMyHelpful: jest.fn(async () => data.helped ?? []),
    postComment: jest.fn(async () => undefined),
    setHelpful: jest.fn(async () => undefined),
    flagComment: jest.fn(async () => undefined),
    fetchMyFlags: jest.fn(async () => data.flagged ?? []),
    withdrawFlag: jest.fn(async () => undefined),
    deleteComment: jest.fn(async () => undefined),
    moderateComment: jest.fn(async () => undefined),
    fetchMyPermissions: jest.fn(async () => {
      if (data.permissions === undefined) {
        throw new Error("my_permissions is not available");
      }
      return data.permissions;
    }),
    fetchFollowingIds: jest.fn(async () => data.following ?? []),
    adminDeleteComment: jest.fn(async () => undefined),
    ...overrides,
  };
  return transport as unknown as FakeTransport;
}

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}
