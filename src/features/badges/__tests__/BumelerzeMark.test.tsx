import { render, screen } from "@testing-library/react-native";

import { BUMELERZE_MARK_PATH } from "../bumelerze-mark";
import { BumelerzeMark } from "../components/BumelerzeMark";

describe("BumelerzeMark", () => {
  it("draws the symbol path and the endpoint dot in the one colour given", async () => {
    await render(<BumelerzeMark width={30} color="#123456" testID="mark" />);
    const svg = screen.getByTestId("mark");
    expect(svg).toBeTruthy();
    // react-native-svg hands colours to native as 0xAARRGGBB numbers.
    const argb = 0xff123456;
    const fills = JSON.stringify(screen.toJSON()).match(
      /"fill":\{"type":0,"payload":(\d+)\}/g,
    );
    // Path and dot share the one colour; the only other fill is the group's
    // untouched default (black), so no red body and no gold dot.
    const own = fills?.filter((f) => f.includes(`:${argb}}`));
    expect(own).toHaveLength(2);
  });

  it("carries the same path as the brand symbol file", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fs read in a test
    const fs = require("fs") as typeof import("fs");
    const svg = fs.readFileSync(
      `${__dirname}/../../../../assets/brand/logo/bumelerze-symbol-color.svg`,
      "utf8",
    );
    expect(svg).toContain(`d="${BUMELERZE_MARK_PATH}"`);
  });
});
