import { act, cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { EventCard } from "../components/EventCard";
import type { Event } from "../types";

/**
 * F6 (event naming): the World and Significant views render these same cards,
 * and they used to show the provider's English prose for any far-field event.
 * One rule now: gazetteer near field, translated Flinn-Engdahl region beyond.
 */
function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: "us7000test",
    bumelerzeId: null,
    originTime: Date.UTC(2026, 9, 5, 12, 0, 0),
    lat: -4.35,
    lon: 152.27,
    depthKm: 30,
    magnitude: { value: 5.6, type: "mww" },
    placeName: "55 km ESE of Kokopo, Papua New Guinea",
    provenance: {
      provider: "usgs",
      providerId: "us7000test",
      fetchedAt: Date.UTC(2026, 9, 5, 12, 5, 0),
      providerUpdatedAt: Date.UTC(2026, 9, 5, 12, 4, 0),
    },
    sig: 500,
    isRegional: false,
    url: "https://example.org/event",
    ...overrides,
  };
}

const NOW = Date.UTC(2026, 9, 5, 13, 0, 0);

describe("EventCard naming (World / Significant)", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    // Unmount first so the language switch below never re-renders a live card.
    await cleanup();
    await act(async () => {
      await i18n.changeLanguage(originalLanguage);
    });
  });

  it("shows the translated F-E region, not the USGS sentence, for a far-field event (English)", async () => {
    await i18n.changeLanguage("en");
    await render(<EventCard event={makeEvent({})} onPress={jest.fn()} now={NOW} />);

    expect(screen.getByText("New Britain region, Papua New Guinea")).toBeTruthy();
    expect(screen.queryByText(/Kokopo/)).toBeNull();
  });

  it("shows the Sorani region name for the same event", async () => {
    await i18n.changeLanguage("ckb");
    await render(<EventCard event={makeEvent({})} onPress={jest.fn()} now={NOW} />);

    expect(screen.getByText("ناوچەی بریتانیای نوێ، پاپوا گینیای نوێ")).toBeTruthy();
    expect(screen.queryByText(/Kokopo/)).toBeNull();
  });

  it("keeps the near-field line for a Kurdistan event, unchanged", async () => {
    await i18n.changeLanguage("en");
    await render(
      <EventCard
        event={makeEvent({
          lat: 35.2,
          lon: 46.0,
          placeName: "32 km SE of Halabja, Iraq",
          isRegional: true,
        })}
        onPress={jest.fn()}
        now={NOW}
      />,
    );

    expect(screen.getByText(/of Halabja, Kurdistan \(Iraq\)$/)).toBeTruthy();
  });

  it("names a USGS event and an EMSC event at the same epicentre identically", async () => {
    await i18n.changeLanguage("en");
    const usgs = makeEvent({
      lat: 33.0,
      lon: 139.5,
      placeName: "Izu Islands, Japan region",
    });
    const emsc = makeEvent({
      id: "emsc-1",
      lat: 33.0,
      lon: 139.5,
      placeName: "SOUTHEAST OF HONSHU, JAPAN",
      provenance: { ...usgs.provenance, provider: "emsc", providerId: "emsc-1" },
    });
    await render(
      <>
        <EventCard event={usgs} onPress={jest.fn()} now={NOW} />
        <EventCard event={emsc} onPress={jest.fn()} now={NOW} />
      </>,
    );

    expect(screen.getAllByText("Southeast of Honshu, Japan")).toHaveLength(2);
    expect(screen.queryByText(/Izu Islands/)).toBeNull();
  });
});
