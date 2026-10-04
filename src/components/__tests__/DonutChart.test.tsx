import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { capSlices, DonutChart, type DonutSlice } from "../DonutChart";

function slice(key: string, value: number, extra: Partial<DonutSlice> = {}): DonutSlice {
  return { key, value, color: "#123456", label: `Label ${key}`, ...extra };
}

describe("DonutChart", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("draws one ring segment per non-empty slice and drops zero slices", async () => {
    await render(
      <DonutChart slices={[slice("a", 3), slice("b", 1), slice("c", 0)]} centerText="4" />,
    );
    expect(screen.getByTestId("donut-slice-a")).toBeTruthy();
    expect(screen.getByTestId("donut-slice-b")).toBeTruthy();
    expect(screen.queryByTestId("donut-slice-c")).toBeNull();
    expect(screen.getByTestId("donut-center")).toBeTruthy();
  });

  it("shows whole-number percents that add up to 100 in the legend", async () => {
    await render(
      <DonutChart slices={[slice("a", 1), slice("b", 1), slice("c", 1)]} />,
    );
    // 33.33 each rounds to 33/33/33; the largest is nudged to make 100.
    expect(screen.getByText(/34%/)).toBeTruthy();
    expect(screen.getAllByText(/33%/)).toHaveLength(2);
  });

  it("never shows a non-empty slice as 0%", async () => {
    await render(<DonutChart slices={[slice("a", 1000), slice("b", 1)]} />);
    expect(screen.getByText(/<1%/)).toBeTruthy();
  });

  it("uses an explicit valueText when given", async () => {
    await render(<DonutChart slices={[slice("a", 1, { valueText: "about half" })]} />);
    expect(screen.getByText(/about half/)).toBeTruthy();
  });

  it("caps the legend at four rows with an Other bucket", async () => {
    const slices = [
      slice("a", 50),
      slice("b", 20),
      slice("c", 15),
      slice("d", 10),
      slice("e", 5),
    ];
    await render(<DonutChart slices={slices} />);
    expect(screen.getByText("Label a")).toBeTruthy();
    expect(screen.getByText("Label b")).toBeTruthy();
    expect(screen.getByText("Label c")).toBeTruthy();
    expect(screen.queryByText("Label d")).toBeNull();
    expect(screen.queryByText("Label e")).toBeNull();
    expect(screen.getByText("Other")).toBeTruthy();
    // d + e = 15%
    expect(screen.getAllByText(/15%/)).toHaveLength(2);
  });

  it("summarises every slice in one accessible label", async () => {
    await render(
      <DonutChart title="What people felt" slices={[slice("a", 3), slice("b", 1)]} />,
    );
    const chart = screen.getByRole("image");
    expect(chart.props.accessibilityLabel).toBe(
      "What people felt. Label a: 75%. Label b: 25%.",
    );
  });

  it("renders nothing when there is nothing to draw", async () => {
    const { toJSON } = await render(<DonutChart slices={[slice("a", 0)]} />);
    expect(toJSON()).toBeNull();
  });

  it("localises the legend digits in Arabic", async () => {
    await i18n.changeLanguage("ar");
    await render(<DonutChart slices={[slice("a", 1), slice("b", 1)]} />);
    expect(screen.getAllByText(/٥٠%/)).toHaveLength(2);
  });
});

describe("capSlices", () => {
  const other = { label: "Other", color: "#999" };

  it("keeps the original order of the kept slices and appends Other", () => {
    const result = capSlices(
      [slice("a", 1), slice("b", 9), slice("c", 5), slice("d", 7), slice("e", 2)],
      4,
      other,
    );
    expect(result.map((s) => s.key)).toEqual(["b", "c", "d", "other"]);
    expect(result[3]?.value).toBe(3);
  });

  it("leaves short lists alone", () => {
    expect(capSlices([slice("a", 1), slice("b", 2)], 4, other)).toHaveLength(2);
  });
});
