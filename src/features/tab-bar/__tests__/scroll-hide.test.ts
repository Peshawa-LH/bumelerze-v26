import {
  BAR_STRIP,
  HIDE_AFTER,
  INITIAL_SCROLL_HIDE_STATE,
  nextScrollHide,
  SHOW_AFTER,
  type ScrollHideState,
} from "../scroll-hide";

const VIEWPORT = 700;

/** Feed a list of offsets through the decision and return the final result. */
function run(
  offsets: number[],
  { contentHeight = 4000, hidden = false, state = INITIAL_SCROLL_HIDE_STATE } = {},
) {
  let current: { state: ScrollHideState; hidden: boolean } = { state, hidden };
  const history: boolean[] = [];
  for (const offset of offsets) {
    current = nextScrollHide(current.hidden, current.state, {
      offset,
      viewportHeight: VIEWPORT,
      contentHeight,
    });
    history.push(current.hidden);
  }
  return { ...current, history };
}

describe("nextScrollHide", () => {
  it("hides the bar when scrolling down past a small distance", () => {
    const { hidden } = run([100, 110, 130, 160, 200]);
    expect(hidden).toBe(true);
  });

  it("does not hide on a tiny scroll down", () => {
    expect(run([100, 105, 110]).hidden).toBe(false);
  });

  it("shows the bar again on a short scroll up", () => {
    const down = run([100, 130, 160, 200, 300]);
    expect(down.hidden).toBe(true);
    const up = run([300 - SHOW_AFTER - 2], { hidden: true, state: down.state });
    expect(up.hidden).toBe(false);
  });

  it("stays hidden while the user keeps scrolling down", () => {
    expect(run([100, 200, 300, 400, 500, 600]).history.slice(-3)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("a change of direction starts counting from zero", () => {
    // 20 px down (under the threshold), 10 px up, 20 px down: never hides.
    expect(run([100, 120, 110, 130]).hidden).toBe(false);
    expect(HIDE_AFTER).toBeGreaterThan(20);
  });

  it("always shows the bar near the top", () => {
    expect(run([0, 10, 20], { hidden: true }).hidden).toBe(false);
  });

  it("never hides on a short page, however it is scrolled", () => {
    const short = VIEWPORT + 150; // only 150 px to scroll
    expect(
      run([0, 40, 80, 120, 150], { contentHeight: short }).history.every((h) => !h),
    ).toBe(true);
  });

  it("shows the bar near the end of the page and cannot flicker there", () => {
    const contentHeight = 3000;
    const end = contentHeight - VIEWPORT; // scrolled all the way down
    // Scroll down to the end in steps, then bounce.
    const offsets = [
      200,
      400,
      800,
      1200,
      1600,
      2000,
      end - 200,
      end - 100,
      end,
      end - 20,
      end,
    ];
    const { history } = run(offsets, { contentHeight });
    // Hidden somewhere in the middle, shown at the end.
    expect(history.some(Boolean)).toBe(true);
    expect(history[history.length - 1]).toBe(false);
  });

  it("hiding does not make the shrunk-by-a-strip page look like the end zone", () => {
    // Hide at the furthest offset the rule allows: afterwards the viewport is a
    // strip taller, so the distance to the end drops by BAR_STRIP. It must
    // still be outside the end zone, or the bar would pop straight back.
    let current = { state: INITIAL_SCROLL_HIDE_STATE, hidden: false };
    const contentHeight = 3000;
    for (let offset = 100; offset < contentHeight; offset += 10) {
      const before = current.hidden;
      current = nextScrollHide(current.hidden, current.state, {
        offset,
        viewportHeight: VIEWPORT,
        contentHeight,
      });
      if (!before && current.hidden) {
        // The sample after the layout change: viewport is BAR_STRIP taller.
        const after = nextScrollHide(true, current.state, {
          offset,
          viewportHeight: VIEWPORT + BAR_STRIP,
          contentHeight,
        });
        expect(after.hidden).toBe(true);
        return;
      }
    }
    throw new Error("the bar never hid");
  });

  it("treats iOS overscroll above the top as the top", () => {
    expect(run([-30], { hidden: true }).hidden).toBe(false);
  });
});
