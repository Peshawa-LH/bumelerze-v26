import { cleanup, render, screen } from "@testing-library/react-native";
import { PixelRatio, Platform, StyleSheet } from "react-native";

import { magnitudeTone } from "@/features/events/magnitude-tone";
import i18n from "@/i18n";
import { lightColors } from "@/theme/semantic";

import { URMIA_CONTOURS, URMIA_EVENT } from "../__fixtures__/events";
import { buildCardModel, type CardModel, type CardText } from "../card-layout";
import { buildCardStrings } from "../card-strings";
import { shareCardHostWidth } from "../CardRenderer";
import { POP_DIRECTIONAL_ISOLATE, RIGHT_TO_LEFT_ISOLATE } from "../config";
import { SHARE_FONT_ASCENT, ShareCardSvg, nativeTextBox } from "../ShareCardSvg";

async function model(locale: string, size: "square" | "story" = "square"): Promise<CardModel> {
  await i18n.changeLanguage(locale);
  return buildCardModel({
    size,
    locale,
    strings: buildCardStrings({
      event: URMIA_EVENT,
      locale,
      t: i18n.t,
      agencies: ["GFZ"],
      reviewStatus: "automatic",
    }),
    magnitudeValue: URMIA_EVENT.magnitude.value,
    epicenter: { lat: URMIA_EVENT.lat, lon: URMIA_EVENT.lon },
    contours: URMIA_CONTOURS,
    url: "https://app.bumelerze.com/e/bml202602ia",
    colors: lightColors,
    magnitudeBandColor: lightColors.magnitudeBand[magnitudeTone(URMIA_EVENT.magnitude.value)],
  });
}

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: (HostNode | string)[] | null;
}

/** Every host element of the rendered card, depth first. */
function hostNodes(): HostNode[] {
  const out: HostNode[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node === "string") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const host = node as HostNode;
    out.push(host);
    host.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}

/** react-native-svg's text elements (`<Text>`, `<TSpan>`). */
function svgTextNodes(): HostNode[] {
  return hostNodes().filter((node) => /^RNSVG(Text|TSpan)$/.test(node.type));
}

const ITEM: CardText = {
  text: "Urmia",
  x: 300,
  y: 500,
  size: 40,
  weight: 400,
  fill: "#111",
  anchor: "start",
  rtl: false,
};

describe("nativeTextBox: an SVG text position as a phone text box", () => {
  it("hangs the box from the anchor edge, a full ascent above the baseline", () => {
    const top = 500 - SHARE_FONT_ASCENT * 40;
    expect(nativeTextBox(ITEM, 1080)).toEqual({ left: 300, top, width: 1080, textAlign: "left" });
    expect(nativeTextBox({ ...ITEM, anchor: "end" }, 1080)).toEqual({
      left: 300 - 1080,
      top,
      width: 1080,
      textAlign: "right",
    });
    expect(nativeTextBox({ ...ITEM, anchor: "middle" }, 1080)).toEqual({
      left: 300 - 540,
      top,
      width: 1080,
      textAlign: "center",
    });
  });

  it("measures a mixed-size line from its tallest run (the big magnitude)", () => {
    const box = nativeTextBox(
      { ...ITEM, runs: [{ text: "M ", size: 60 }, { text: "3.2", size: 176 }] },
      1080,
    );
    expect(box.top).toBeCloseTo(500 - SHARE_FONT_ASCENT * 176);
  });
});

describe("ShareCardSvg on the phone", () => {
  afterEach(cleanup);
  afterAll(() => i18n.changeLanguage("en"));

  it("draws every word as phone text, never as react-native-svg text (Sorani came out unjoined)", async () => {
    const card = await model("ckb");
    await render(<ShareCardSvg model={card} displayWidth={360} />);
    // The bug: react-native-svg on iOS drew Sorani letters one by one,
    // overlapping and unjoined (iOS Simulator, 2026-10-20).
    expect(svgTextNodes()).toHaveLength(0);
    const place = card.texts.find((item) => item.text.includes("ورمێ"));
    expect(place).toBeDefined();
    // Right-to-left strings keep their bidi isolate, as in the SVG.
    expect(
      screen.getByText(`${RIGHT_TO_LEFT_ISOLATE}${place!.text}${POP_DIRECTIONAL_ISOLATE}`),
    ).toBeTruthy();
  });

  it("uses the card's Vazirmatn faces at the card's scale, never the phone's text size setting", async () => {
    const card = await model("en");
    await render(<ShareCardSvg model={card} displayWidth={540} />);
    const place = card.texts.find((item) => item.text.includes("Urmia"))!;
    const node = screen.getByText(place.text);
    const style = StyleSheet.flatten(node.props.style);
    expect(style.fontFamily).toBe(place.weight === 700 ? "Vazirmatn-Bold" : "Vazirmatn-Regular");
    expect(style.fontSize).toBeCloseTo(place.size * 0.5);
    expect(node.props.allowFontScaling).toBe(false);
  });

  it("keeps its own left-to-right box under a right-to-left app layout", async () => {
    const card = await model("ckb");
    await render(<ShareCardSvg model={card} displayWidth={360} />);
    const root = StyleSheet.flatten(screen.getByTestId("share-card-native").props.style);
    expect(root.direction).toBe("ltr");
    expect(root.width).toBe(360);
    expect(root.height).toBe(360);
  });

  it("paints a halo behind map labels", async () => {
    const card = await model("en");
    const label = card.map.labels.find((item) => item.halo);
    expect(label).toBeDefined();
    await render(<ShareCardSvg model={card} displayWidth={360} />);
    const copies = hostNodes().filter(
      (node) => node.type === "Text" && node.children?.join("") === label!.text,
    );
    // Eight halo copies and the label itself.
    expect(copies).toHaveLength(9);
  });

  it("draws the story card's QR code and prompt", async () => {
    const card = await model("en", "story");
    await render(<ShareCardSvg model={card} displayWidth={360} />);
    const prompt = card.texts.filter((item) => i18n.t("share.card.prompt").includes(item.text));
    expect(prompt.length).toBeGreaterThan(0);
    for (const line of prompt) {
      expect(screen.getByText(line.text)).toBeTruthy();
    }
    expect(StyleSheet.flatten(screen.getByTestId("share-card-native").props.style).height).toBe(640);
  });
});

describe("ShareCardSvg on the web", () => {
  const original = Platform.OS;
  beforeEach(() => {
    Platform.OS = "web";
  });
  afterEach(() => {
    cleanup();
    Platform.OS = original;
  });

  it("stays one SVG with its text inside (the web export serialises it)", async () => {
    const card = await model("en");
    await render(<ShareCardSvg model={card} displayWidth={270} />);
    expect(screen.queryByTestId("share-card-native")).toBeNull();
    expect(svgTextNodes().length).toBeGreaterThan(card.texts.length);
  });
});

describe("shareCardHostWidth", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
    jest.restoreAllMocks();
  });

  it("mounts the phone card at the size that captures as 1080 pixels", () => {
    jest.spyOn(PixelRatio, "get").mockReturnValue(3);
    expect(shareCardHostWidth()).toBe(360);
    jest.spyOn(PixelRatio, "get").mockReturnValue(2);
    expect(shareCardHostWidth()).toBe(540);
  });

  it("keeps the web's small hidden card (the web exporter draws at 1080)", () => {
    Platform.OS = "web";
    expect(shareCardHostWidth()).toBe(270);
  });
});
