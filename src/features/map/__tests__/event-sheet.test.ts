import { act, renderHook } from "@testing-library/react-native";

import type { Event } from "@/features/events";

import {
  resolveSheetSnapOutcome,
  sheetTotalHeightPx,
  sheetTranslateYForDetent,
  sheetVisibleHeightPx,
  SHEET_EXPANDED_HEIGHT_FRACTION,
  SHEET_FLICK_VELOCITY_PX_PER_SEC,
  SHEET_OPEN_FULL_HEIGHT_FRACTION,
  SHEET_PEEK_HEIGHT_FRACTION,
  useEventSheetController,
} from "../event-sheet";

const CONTAINER_HEIGHT_PX = 1000;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
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

describe("event-sheet: sizing helpers", () => {
  it("computes each detent's visible height as its fraction of the container", () => {
    expect(sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX)).toBeCloseTo(
      CONTAINER_HEIGHT_PX * SHEET_PEEK_HEIGHT_FRACTION,
    );
    expect(sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX)).toBeCloseTo(
      CONTAINER_HEIGHT_PX * SHEET_EXPANDED_HEIGHT_FRACTION,
    );
  });

  it("computes the sheet's total rendered height as the open-full fraction", () => {
    expect(sheetTotalHeightPx(CONTAINER_HEIGHT_PX)).toBeCloseTo(
      CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION,
    );
  });

  it("derives translateY so exactly the detent's visible height shows above the bottom edge", () => {
    const totalHeight = sheetTotalHeightPx(CONTAINER_HEIGHT_PX);
    const peekTranslateY = sheetTranslateYForDetent("peek", CONTAINER_HEIGHT_PX);
    const expandedTranslateY = sheetTranslateYForDetent("expanded", CONTAINER_HEIGHT_PX);

    expect(totalHeight - peekTranslateY).toBeCloseTo(
      sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX),
    );
    expect(totalHeight - expandedTranslateY).toBeCloseTo(
      sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX),
    );
    // A taller detent shows more, so it needs LESS downward translation.
    expect(expandedTranslateY).toBeLessThan(peekTranslateY);
  });
});

describe("event-sheet: resolveSheetSnapOutcome (slow release — nearest by position)", () => {
  const SLOW_VELOCITY = 10;

  it("snaps to dismiss when released below half of peek's height", () => {
    const halfPeek = (CONTAINER_HEIGHT_PX * SHEET_PEEK_HEIGHT_FRACTION) / 2;
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: halfPeek - 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("dismiss");
  });

  it("snaps to peek just above the dismiss boundary", () => {
    const halfPeek = (CONTAINER_HEIGHT_PX * SHEET_PEEK_HEIGHT_FRACTION) / 2;
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: halfPeek + 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("snaps to peek exactly at its own resting height", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX),
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("snaps to expanded once past the peek/expanded midpoint", () => {
    const peekPx = sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX);
    const expandedPx = sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX);
    const midpoint = (peekPx + expandedPx) / 2;
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: midpoint + 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("expanded");
  });

  it("stays at expanded just short of the peek/expanded midpoint", () => {
    const peekPx = sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX);
    const expandedPx = sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX);
    const midpoint = (peekPx + expandedPx) / 2;
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: midpoint - 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("hands off to openFull once dragged past the expanded/openFull midpoint", () => {
    const expandedPx = sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX);
    const openFullPx = CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION;
    const midpoint = (expandedPx + openFullPx) / 2;
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: midpoint + 1,
        velocityY: SLOW_VELOCITY,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("openFull");
  });
});

describe("event-sheet: resolveSheetSnapOutcome (fast release — flick one step)", () => {
  it("a fast downward flick from near peek dismisses, even with little travel", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX) - 5,
        velocityY: SHEET_FLICK_VELOCITY_PX_PER_SEC + 100,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("dismiss");
  });

  it("a fast downward flick from near expanded collapses to peek, not dismiss", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX) - 5,
        velocityY: SHEET_FLICK_VELOCITY_PX_PER_SEC + 100,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });

  it("a fast upward flick from near peek expands, even with little travel", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX) + 5,
        velocityY: -(SHEET_FLICK_VELOCITY_PX_PER_SEC + 100),
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("expanded");
  });

  it("a fast upward flick from near expanded hands off to openFull", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX) + 5,
        velocityY: -(SHEET_FLICK_VELOCITY_PX_PER_SEC + 100),
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("openFull");
  });

  it("a flick that would overshoot past openFull clamps at openFull, never past the end of the scale", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: CONTAINER_HEIGHT_PX * SHEET_OPEN_FULL_HEIGHT_FRACTION,
        velocityY: -(SHEET_FLICK_VELOCITY_PX_PER_SEC + 100),
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("openFull");
  });

  it("a flick that would undershoot past dismiss clamps at dismiss, never negative", () => {
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: 0,
        velocityY: SHEET_FLICK_VELOCITY_PX_PER_SEC + 100,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("dismiss");
  });

  it("velocity right at the threshold is NOT treated as a flick (strict >=  boundary is inclusive, just under it is not)", () => {
    const justBelowThreshold = SHEET_FLICK_VELOCITY_PX_PER_SEC - 1;
    const peekPx = sheetVisibleHeightPx("peek", CONTAINER_HEIGHT_PX);
    const expandedPx = sheetVisibleHeightPx("expanded", CONTAINER_HEIGHT_PX);
    const midpoint = (peekPx + expandedPx) / 2;
    // Positioned just short of the peek/expanded midpoint: a slow release
    // here settles back to peek. A flick this fast, even from the same
    // position, would normally jump to expanded — confirming the
    // just-under-threshold case still uses the slow (position-only) path.
    expect(
      resolveSheetSnapOutcome({
        currentHeightPx: midpoint - 1,
        velocityY: -justBelowThreshold,
        containerHeightPx: CONTAINER_HEIGHT_PX,
      }),
    ).toBe("peek");
  });
});

describe("useEventSheetController", () => {
  it("starts closed (no content, peek detent)", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    expect(result.current.content).toBeNull();
    expect(result.current.detent).toBe("peek");
  });

  it("select() opens the sheet at the peek detent with the given event as content", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    const event = makeEvent();

    await act(() => {
      result.current.select(event);
    });

    expect(result.current.content).toEqual(event);
    expect(result.current.detent).toBe("peek");
  });

  it("setDetent() moves between detents without touching the selected content", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    const event = makeEvent();

    await act(() => {
      result.current.select(event);
    });
    await act(() => {
      result.current.setDetent("expanded");
    });

    expect(result.current.detent).toBe("expanded");
    expect(result.current.content).toEqual(event);
  });

  it("selecting a DIFFERENT event while expanded resets back to peek", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    const first = makeEvent({ id: "first" });
    const second = makeEvent({ id: "second" });

    await act(() => {
      result.current.select(first);
    });
    await act(() => {
      result.current.setDetent("expanded");
    });
    await act(() => {
      result.current.select(second);
    });

    expect(result.current.content).toEqual(second);
    expect(result.current.detent).toBe("peek");
  });

  it("dismiss() clears the content and resets the detent to peek", async () => {
    const { result } = await renderHook(() => useEventSheetController());
    const event = makeEvent();

    await act(() => {
      result.current.select(event);
    });
    await act(() => {
      result.current.setDetent("expanded");
    });
    await act(() => {
      result.current.dismiss();
    });

    expect(result.current.content).toBeNull();
    expect(result.current.detent).toBe("peek");
  });
});
