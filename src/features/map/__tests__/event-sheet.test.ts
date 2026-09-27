import { act, renderHook } from "@testing-library/react-native";

import type { Event } from "@/features/events";

import {
  resolveSheetSnapOutcome,
  sheetTotalHeightPx,
  sheetTranslateYForDetent,
  sheetVisibleHeightPx,
  SHEET_FLICK_VELOCITY_PX_PER_SEC,
  SHEET_OPEN_FULL_HEIGHT_FRACTION,
  SHEET_PEEK_HEIGHT_FRACTION,
  useEventSheetController,
} from "../event-sheet";

const CONTAINER_HEIGHT_PX = 1000;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    bumelerzeId: null,
    originTime: Date.UTC(2026, 7, 15, 12, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "32 km SE of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    ...overrides,
  };
}

/** One resting height since 2026-09-27: the sheet shows every basic fact
 * of an event at once, so there is nothing to expand to. The only ways out
 * are dismiss (down) and the full event route (up). */
describe("event-sheet: sizing helpers", () => {
  it("computes the resting visible height as its fraction of the container", () => {
    expect(sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX)).toBeCloseTo(
      CONTAINER_HEIGHT_PX * SHEET_PEEK_HEIGHT_FRACTION,
    );
  });

  it("rests tall enough for the whole preview without covering most of the map", () => {
    // Magnitude, tags, place, relative time, local time, depth, distance
    // and two actions need roughly 300 px on a phone; the map must stay
    // visible above. Guards against a future "tidy" shrink that would
    // clip the details again.
    expect(SHEET_PEEK_HEIGHT_FRACTION).toBeGreaterThanOrEqual(0.42);
    expect(SHEET_PEEK_HEIGHT_FRACTION).toBeLessThan(SHEET_OPEN_FULL_HEIGHT_FRACTION);
  });

  it("computes the sheet's total rendered height as the open-full fraction", () => {
    expect(sheetTotalHeightPx(CONTAINER_HEIGHT_PX)).toBeCloseTo(
      CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION,
    );
  });

  it("derives translateY so exactly the resting height shows above the bottom edge", () => {
    const totalHeight = sheetTotalHeightPx(CONTAINER_HEIGHT_PX);
    const peekTranslateY = sheetTranslateYForDetent("peek", CONTAINER_HEIGHT_PX);
    expect(totalHeight - peekTranslateY).toBeCloseTo(
      sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX),
    );
    expect(peekTranslateY).toBeGreaterThan(0);
  });
});

describe("event-sheet: resolveSheetSnapOutcome (slow release — nearest by position)", () => {
  const SLOW_VELOCITY = 10;
  const peekPx = CONTAINER_HEIGHT_PX * SHEET_PEEK_HEIGHT_FRACTION;
  const openFullPx = CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION;

  it("snaps to dismiss when released below half of the resting height", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: peekPx / 2 - 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("dismiss");
  });

  it("snaps back to rest just above the dismiss boundary", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: peekPx / 2 + 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("snaps to rest exactly at the resting height", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: peekPx,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("stays at rest just short of the rest/openFull midpoint", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: (peekPx + openFullPx) / 2 - 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("hands off to openFull once dragged past the rest/openFull midpoint", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: (peekPx + openFullPx) / 2 + 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("openFull");
  });
});

describe("event-sheet: resolveSheetSnapOutcome (fast release — flick one step)", () => {
  const peekPx = CONTAINER_HEIGHT_PX * SHEET_PEEK_HEIGHT_FRACTION;

  it("a fast downward flick from near rest dismisses, even with little travel", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: peekPx - 5,
        velocityY: SHEET_FLICK_VELOCITY_PX_PER_SEC + 100,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("dismiss");
  });

  it("a fast upward flick from near rest hands off to openFull, even with little travel", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: peekPx + 5,
        velocityY: -(SHEET_FLICK_VELOCITY_PX_PER_SEC + 100),
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("openFull");
  });

  it("a flick that would overshoot past openFull clamps at openFull", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION,
        velocityY: -(SHEET_FLICK_VELOCITY_PX_PER_SEC + 100),
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("openFull");
  });

  it("a flick that would undershoot past dismiss clamps at dismiss", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: 0,
        velocityY: SHEET_FLICK_VELOCITY_PX_PER_SEC + 100,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("dismiss");
  });

  it("velocity just under the threshold is NOT a flick: position alone decides", () => {
    const openFullPx = CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION;
    // Just short of the rest/openFull midpoint, moving up fast but under
    // the flick threshold: a flick would hand off, a slow release rests.
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: (peekPx + openFullPx) / 2 - 1,
        velocityY: -(SHEET_FLICK_VELOCITY_PX_PER_SEC - 1),
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });
});

describe("useEventSheetController", () => {
  it("starts closed (no content)", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    expect(result.current.content).toBeNull();
    expect(result.current.detent).toBe("peek");
  });

  it("select() opens the sheet with the given event as content", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    const event = makeEvent();

    await act(() => {
      result.current.select(event);
    });

    expect(result.current.content).toEqual(event);
    expect(result.current.detent).toBe("peek");
  });

  it("selecting a DIFFERENT event replaces the content", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    const first = makeEvent({ id: "first" });
    const second = makeEvent({ id: "second" });

    await act(() => {
      result.current.select(first);
    });
    await act(() => {
      result.current.select(second);
    });

    expect(result.current.content).toEqual(second);
  });

  it("dismiss() clears the content", async () => {
    const { result } = await renderHook(() => useEventSheetController());

    await act(() => {
      result.current.select(makeEvent());
    });
    await act(() => {
      result.current.dismiss();
    });

    expect(result.current.content).toBeNull();
    expect(result.current.detent).toBe("peek");
  });
});
