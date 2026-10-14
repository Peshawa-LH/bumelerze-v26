import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import { WebTabButton } from "../web-tab-button";

const mockReceived: Record<string, unknown>[] = [];
jest.mock("expo-router/react-navigation", () => ({
  PlatformPressable: (props: Record<string, unknown>) => {
    mockReceived.push(props);
    return null;
  },
}));

describe("WebTabButton", () => {
  beforeEach(() => {
    mockReceived.length = 0;
  });

  it("is not a link and has no long press, so a held press still opens the tab", async () => {
    const onPress = jest.fn();
    await render(
      <WebTabButton href="/badges" onLongPress={jest.fn()} onPress={onPress} role="tab">
        <Text>Home</Text>
      </WebTabButton>,
    );
    const props = mockReceived.at(-1) ?? {};
    expect(props.href).toBeUndefined();
    expect(props.onLongPress).toBeUndefined();
    expect(props.onPress).toBe(onPress);
    expect(props.role).toBe("tab");
  });

  it("keeps the tab's own style and makes the label unselectable", async () => {
    await render(
      <WebTabButton style={{ flex: 1 }}>
        <Text>Home</Text>
      </WebTabButton>,
    );
    expect(mockReceived.at(-1)?.style).toEqual([{ flex: 1 }, { userSelect: "none" }]);
  });
});
