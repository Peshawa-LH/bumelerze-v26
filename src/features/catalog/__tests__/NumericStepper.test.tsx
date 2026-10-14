import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import {
  HOLD_REPEAT_INTERVAL_MS,
  HOLD_REPEAT_START_DELAY_MS,
  NumericStepper,
} from "../components/NumericStepper";

/**
 * Review A-1 (2026-10-14): a quick tap on +/− did nothing on the web, and a
 * two-second hold stepped exactly once (the repeat timer closed over the
 * value of the render the press began in). Tap, short press and hold are
 * driven here as the press events a touch produces: pressIn, pressOut,
 * press (the release).
 */
function Harness({ onChange, start = 0 }: { onChange: jest.Mock; start?: number }) {
  // The real parent keeps the value in state and hands it back down, so a
  // hold has to step from the LATEST value, not the first one.
  const [value, setValue] = useState(start);
  return (
    <NumericStepper
      label="Min magnitude"
      value={value}
      min={0}
      max={8}
      step={0.5}
      decimals={1}
      formatValue={(v) => v.toFixed(1)}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      decrementA11yLabel="Decrease"
      incrementA11yLabel="Increase"
      testID="stepper"
    />
  );
}

async function touch(label: string, holdMs: number) {
  const button = screen.getByLabelText(label);
  await fireEvent(button, "pressIn");
  await act(async () => {
    jest.advanceTimersByTime(holdMs);
  });
  await fireEvent(button, "pressOut");
  await fireEvent.press(button);
}

describe("NumericStepper taps and holds", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a plain press (a tap or a mouse click) steps exactly once", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText("Increase"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("a 60 ms and a 150 ms touch each step once, never twice", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await touch("Increase", 60);
    expect(onChange).toHaveBeenCalledTimes(1);
    await touch("Increase", 150);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("a 2 s hold repeats from the latest value and the release adds no extra step", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await touch("Increase", 2000);
    // One step per repeat tick after the start delay (the exact count
    // depends on where the test renderer's own ticks fall, so a tick of
    // slack is allowed), and NOT one step per tick plus one for the release.
    const expected = Math.floor((2000 - HOLD_REPEAT_START_DELAY_MS) / HOLD_REPEAT_INTERVAL_MS);
    const repeats = onChange.mock.calls.length;
    expect(repeats).toBeGreaterThanOrEqual(expected - 1);
    expect(repeats).toBeLessThanOrEqual(expected);
    // Each repeat stepped from where the previous one left the value.
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(
      Array.from({ length: repeats }, (_, i) => (i + 1) * 0.5),
    );
    expect(screen.getByTestId("stepper").props.value).toBe((repeats * 0.5).toFixed(1));
  });

  it("a hold stops at the limit instead of repeating the same value", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} start={7} />);
    await touch("Increase", 2000);
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([7.5, 8]);
  });

  it("the decrement side holds too, downwards", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} start={2} />);
    await touch("Decrease", HOLD_REPEAT_START_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 2 + 10);
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([1.5, 1]);
  });

  it("a release before the hold delay is just a tap", async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    await touch("Increase", HOLD_REPEAT_START_DELAY_MS - 50);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
