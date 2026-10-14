import { renderHook } from "@testing-library/react-native";

import { useHorizontalSwipeLock } from "../carousel/swipe-lock.web";

/** A touch event with the few fields the lock reads. */
function touch(type: string, x: number, y: number): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
  return event;
}

async function setup() {
  const node = new EventTarget();
  const ref = { current: node as never };
  await renderHook(() => useHorizontalSwipeLock(ref, true));
  return node;
}

describe("useHorizontalSwipeLock (web)", () => {
  it("holds the page still for the rest of a sideways swipe", async () => {
    const node = await setup();
    node.dispatchEvent(touch("touchstart", 100, 100));
    const small = touch("touchmove", 103, 101);
    node.dispatchEvent(small);
    expect(small.defaultPrevented).toBe(false); // not decided yet
    const sideways = touch("touchmove", 112, 104);
    node.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(true);
    // Later the finger drifts down: still the carousel's swipe.
    const drift = touch("touchmove", 140, 130);
    node.dispatchEvent(drift);
    expect(drift.defaultPrevented).toBe(true);
  });

  it("lets the page scroll for an up-and-down move, every time", async () => {
    const node = await setup();
    node.dispatchEvent(touch("touchstart", 100, 100));
    const down = touch("touchmove", 102, 112);
    node.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    const sideways = touch("touchmove", 160, 115);
    node.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(false);
    // A new touch is decided afresh.
    node.dispatchEvent(touch("touchstart", 100, 100));
    const next = touch("touchmove", 115, 102);
    node.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(true);
  });
});
