import { fireEvent, render, screen } from "@testing-library/react-native";

import { ChannelLegend } from "../components/ChannelLegend";

describe("ChannelLegend", () => {
  it("is a plain legend without the flip button outside the 3D view", async () => {
    await render(<ChannelLegend />);
    expect(screen.getByText("X")).toBeTruthy();
    expect(screen.queryByTestId("sensor-flip-phone")).toBeNull();
  });

  it("ends with a Flip phone button in the 3D view that toggles the pose", async () => {
    const onTogglePose = jest.fn();
    await render(<ChannelLegend pose="standing" onTogglePose={onTogglePose} />);

    const button = screen.getByRole("button", { name: "Flip phone" });
    expect(button.props.accessibilityValue).toEqual({ text: "Standing" });
    fireEvent.press(button);
    expect(onTogglePose).toHaveBeenCalledTimes(1);
  });

  it("names the current pose for screen readers", async () => {
    await render(<ChannelLegend pose="flat" onTogglePose={jest.fn()} />);
    expect(screen.getByTestId("sensor-flip-phone").props.accessibilityValue).toEqual({
      text: "Lying flat",
    });
  });
});
