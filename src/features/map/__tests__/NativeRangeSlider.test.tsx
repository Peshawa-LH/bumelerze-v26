import { fireEvent, render, screen } from "@testing-library/react-native";

import {
  nearerThumb,
  NativeRangeSlider,
  snapToStep,
  valueAtPosition,
} from "../components/NativeRangeSlider";

describe("NativeRangeSlider maths", () => {
  it("snaps to the step grid without floating-point tails", () => {
    expect(snapToStep(4.63, 2, 7, 0.1)).toBe(4.6);
    expect(snapToStep(4.66, 2, 7, 0.1)).toBe(4.7);
    expect(snapToStep(9, 2, 7, 0.1)).toBe(7);
    expect(snapToStep(-1, 2, 7, 0.1)).toBe(2);
  });

  it("reads a touch position left to right, and mirrored right to left", () => {
    expect(valueAtPosition(0, 200, 0, 10, false)).toBe(0);
    expect(valueAtPosition(150, 200, 0, 10, false)).toBe(7.5);
    // Sorani/Arabic: the low end is on the right, as the web's dir="rtl" inputs.
    expect(valueAtPosition(150, 200, 0, 10, true)).toBe(2.5);
    expect(valueAtPosition(400, 200, 0, 10, true)).toBe(0);
    expect(valueAtPosition(10, 0, 0, 10, false)).toBe(0);
  });

  it("gives a touch to the nearer thumb, and to the side it is on when they meet", () => {
    expect(nearerThumb(3, 2, 7)).toBe("low");
    expect(nearerThumb(6, 2, 7)).toBe("high");
    expect(nearerThumb(5, 5, 5)).toBe("high");
    expect(nearerThumb(4, 5, 5)).toBe("low");
  });
});

describe("NativeRangeSlider accessibility", () => {
  it("exposes each thumb as an adjustable control with the web input's label", async () => {
    const onChange = jest.fn();
    await render(
      <NativeRangeSlider
        testID="slider"
        min={2}
        max={7}
        step={0.1}
        low={3}
        high={6}
        onChange={onChange}
        lowLabel="Minimum magnitude"
        highLabel="Maximum magnitude"
        formatValue={(value) => value.toFixed(1)}
      />,
    );
    const low = screen.getByLabelText("Minimum magnitude");
    expect(low.props.accessibilityRole).toBe("adjustable");
    expect(low.props.accessibilityValue).toEqual({ text: "3.0" });

    await fireEvent(low, "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ low: 3.1, high: 6 });

    const high = screen.getByLabelText("Maximum magnitude");
    await fireEvent(high, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ low: 3, high: 5.9 });
  });

  it("never lets the thumbs cross", async () => {
    const onChange = jest.fn();
    await render(
      <NativeRangeSlider
        min={0}
        max={10}
        step={1}
        accessibilityStep={2}
        low={5}
        high={6}
        onChange={onChange}
        lowLabel="low"
        highLabel="high"
        formatValue={String}
      />,
    );
    await fireEvent(screen.getByLabelText("low"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ low: 6, high: 6 });
  });
});
