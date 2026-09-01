/**
 * End-to-end integration test for the "closing the last gap" wave: renders
 * the REAL `ShakeMapSection` (no `useResolvedShakeMap`/`useShakeMap` mock)
 * against a fixture live Supabase transport, through a real
 * `QueryClientProvider`. Only `@/lib/supabase`'s client factory and the
 * global `fetch` (the artifact request) are stubbed — everything else
 * (`useShakeMap`, `useLiveShakeMap`, `resolveShakeMapProduct`,
 * `ShakeMapView`, i18n) runs for real, matching this repo's other
 * event-detail-shaped integration coverage
 * (`features/events/__tests__/event-detail-gating.test.tsx`).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { ShakeMapSection } from "../components/ShakeMapSection";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
  getSupabaseClient: jest.fn(),
}));

const mockedIsSupabaseConfigured = isSupabaseConfigured as jest.MockedFunction<
  typeof isSupabaseConfigured
>;
const mockedGetSupabaseClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

const INTERNAL_UUID = "22222222-2222-4222-8222-222222222222";
const LIVE_STORAGE_PATH = "https://example.test/events/bml00042/v5/cont_mi.json";

function buildFakeSupabaseClient(row: Record<string, unknown> | null) {
  const eq3 = jest.fn().mockResolvedValue({ data: row ? [row] : [], error: null });
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  const select = jest.fn(() => ({ eq: eq1 }));
  const from = jest.fn(() => ({ select }));
  const rpc = jest.fn().mockResolvedValue({ data: INTERNAL_UUID, error: null });
  return { rpc, from };
}

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 5,
    storage_path: LIVE_STORAGE_PATH,
    data_used: {
      conditioning_applied: { ems: true },
      instrument_stations_parsed: 6,
      dyfi_boxes_parsed: 3,
      engine_version: { service_version: "0.2.0" },
    },
    review_status: "automatic",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function eventWithId(id: string): Event {
  return {
    id,
    originTime: 1510510697000,
    lat: 34.9109,
    lon: 45.9592,
    depthKm: 19,
    magnitude: { value: 7.3, type: "mww" },
    placeName: "29 km S of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 730,
    isRegional: true,
    url: "",
  };
}

async function renderWithClient(event: Event) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return await render(
    <Wrapper>
      <ShakeMapSection event={event} />
    </Wrapper>,
  );
}

describe("ShakeMapSection — live product integration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockedIsSupabaseConfigured.mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => halabjaContours,
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows a live product (version, engine version, data-used, provisional label) for an event with no bundled atlas entry", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      buildFakeSupabaseClient(liveRow()) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    await renderWithClient(eventWithId("bml00042"));

    expect(
      await screen.findByText(
        i18n.t("eventDetail.shakemap.citation", { producer: "Bumelerze", version: "5" }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.engineVersion", { version: "0.2.0" })),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.dataUsed.stationAndDyfiConditioned")),
    ).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.shakemap.reviewStatus.automatic")),
    ).toBeTruthy();
  });

  it("prefers the live product over the bundled Atlas entry for an event that has BOTH", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      buildFakeSupabaseClient(liveRow({ version: 9 })) as unknown as ReturnType<
        typeof getSupabaseClient
      >,
    );

    // us2000bmcg IS one of the 11 bundled Historical events (real bundled
    // version 6, atlas/data/us2000bmcg.json, "risk-dashboard" wave's
    // engine regeneration bumped it from 3 to 6) — the live fixture above
    // publishes version 9 for the SAME event id.
    await renderWithClient(eventWithId("us2000bmcg"));

    expect(
      await screen.findByText(
        i18n.t("eventDetail.shakemap.citation", { producer: "Bumelerze", version: "9" }),
      ),
    ).toBeTruthy();
    // The bundled entry's own version (6) must not be what's shown.
    expect(
      screen.queryByText(
        i18n.t("eventDetail.shakemap.citation", { producer: "Bumelerze", version: "6" }),
      ),
    ).toBeNull();
  });

  it("falls back to the bundled Atlas entry when the live fetch fails, for an event that has both", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      buildFakeSupabaseClient(liveRow()) as unknown as ReturnType<typeof getSupabaseClient>,
    );
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    await renderWithClient(eventWithId("us2000bmcg"));

    // Falls back to the bundled entry's own version (the real bundled
    // Atlas entry for us2000bmcg is v6 — atlas/data/us2000bmcg.json),
    // never blank.
    expect(
      await screen.findByText(
        i18n.t("eventDetail.shakemap.citation", { producer: "Bumelerze", version: "6" }),
      ),
    ).toBeTruthy();
    // The bundled path never carries an engine-version line.
    expect(
      screen.queryByText(i18n.t("eventDetail.shakemap.engineVersion", { version: "0.2.0" })),
    ).toBeNull();
  });

  it("renders nothing for an event with neither a live nor a bundled product", async () => {
    mockedGetSupabaseClient.mockReturnValue(
      buildFakeSupabaseClient(null) as unknown as ReturnType<typeof getSupabaseClient>,
    );

    const { toJSON } = await renderWithClient(eventWithId("bml_nothing_here"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toJSON()).toBeNull();
  });
});
