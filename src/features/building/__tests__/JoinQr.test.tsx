import { render, screen } from "@testing-library/react-native";

import "@/i18n";
import { neutral } from "@/theme/palette";
import { JoinQr } from "../components/JoinQr";

const mockQr = jest.fn();
jest.mock("react-native-qrcode-svg", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockQr(props);
    return null;
  },
}));

describe("JoinQr", () => {
  it("draws the text it is given in dark modules on a white card, whatever the theme", async () => {
    await render(
      <JoinQr value="https://bumelerze.com/app/home/join?code=BMH-7K3Q9P&key=ABCD2345" />,
    );
    expect(mockQr).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "https://bumelerze.com/app/home/join?code=BMH-7K3Q9P&key=ABCD2345",
        color: neutral[1100],
        backgroundColor: neutral[0],
      }),
    );
  });

  it("is one image for screen readers with a plain label", async () => {
    await render(<JoinQr value="x" />);
    const qr = screen.getByTestId("family-qr");
    expect(qr.props.accessibilityRole).toBe("image");
    expect(qr.props.accessibilityLabel).toBe("QR code to join this home");
  });
});
