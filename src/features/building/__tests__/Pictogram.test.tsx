import { fireEvent, render, screen } from "@testing-library/react-native";

import { PictureOption } from "../components/ui";
import { Pictogram } from "../components/Pictogram";
import { PICTOGRAM_XML } from "../pictograms.generated";

const mockSvgXml = jest.fn();
jest.mock("react-native-svg", () => ({
  SvgXml: (props: Record<string, unknown>) => {
    mockSvgXml(props);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
    const { View } = require("react-native");
    return <View testID="svg" />;
  },
}));

describe("Pictogram", () => {
  beforeEach(() => mockSvgXml.mockClear());

  it("draws the SVG text with SvgXml, tinted through the color prop (not expo-image tintColor)", async () => {
    await render(<Pictogram name="structure-frame" color="#123456" size={48} />);
    expect(mockSvgXml).toHaveBeenCalledWith(
      expect.objectContaining({
        xml: PICTOGRAM_XML["structure-frame"],
        color: "#123456",
        width: 48,
        height: 48,
      }),
    );
  });
});

describe("PictureOption", () => {
  it("is one accessible radio named by its label; the drawing itself is hidden from screen readers", async () => {
    const onPress = jest.fn();
    await render(
      <PictureOption
        label="Block walls"
        pictogram="structure-block-walls"
        selected
        onPress={onPress}
        testID="opt"
      />,
    );
    const option = screen.getByTestId("opt");
    expect(option.props.accessibilityRole).toBe("radio");
    expect(option.props.accessibilityLabel).toBe("Block walls");
    expect(option.props.accessibilityState).toEqual({ selected: true });
    expect(mockSvgXml.mock.calls.at(-1)?.[0]).toMatchObject({
      accessible: false,
      importantForAccessibility: "no-hide-descendants",
    });
    await fireEvent.press(option);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
