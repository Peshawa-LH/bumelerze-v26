/**
 * @jest-environment jsdom
 */
import { base64ToPngFile, buildFontFaceCss, serializeCardSvg } from "../svg-serialize";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONTS = {
  regularFamily: "Vazirmatn-Regular",
  regularBase64: "UkVHVUxBUg==",
  boldFamily: "Vazirmatn-Bold",
  boldBase64: "Qk9MRA==",
};

function mountedCard(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "270");
  svg.setAttribute("height", "270");
  svg.setAttribute("viewBox", "0 0 1080 1080");
  svg.setAttribute("class", "css-injected-by-react-native-web");
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("font-family", "Vazirmatn-Bold");
  text.textContent = "بوومەلەرزە";
  svg.appendChild(text);
  const host = document.createElement("div");
  host.setAttribute("dir", "rtl");
  host.appendChild(svg);
  document.body.appendChild(host);
  return svg;
}

describe("buildFontFaceCss", () => {
  it("embeds both faces as base64 woff2, each by the family name the card uses", () => {
    const css = buildFontFaceCss(FONTS);
    expect(css).toContain("font-family:'Vazirmatn-Regular'");
    expect(css).toContain("font-family:'Vazirmatn-Bold'");
    expect(css).toContain("src:url(data:font/woff2;base64,UkVHVUxBUg==) format('woff2')");
    expect(css).toContain("src:url(data:font/woff2;base64,Qk9MRA==) format('woff2')");
  });

  it("keeps the weight normal so the browser never fakes a second bold", () => {
    const css = buildFontFaceCss(FONTS);
    expect(css.match(/font-weight:400/g)).toHaveLength(2);
    expect(css).not.toMatch(/font-weight:(700|bold)/);
  });
});

describe("serializeCardSvg", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns a standalone svg document with the font faces inside it", () => {
    const out = serializeCardSvg(mountedCard(), { width: 1080, height: 1080 }, FONTS);
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain("<style");
    expect(out).toContain("@font-face{font-family:'Vazirmatn-Bold'");
    expect(out).toContain("base64,UkVHVUxBUg==");
    expect(out).toContain("base64,Qk9MRA==");
    // The text is carried over untouched.
    expect(out).toContain("بوومەلەرزە");
  });

  it("puts the style first, before anything that uses the fonts", () => {
    const out = serializeCardSvg(mountedCard(), { width: 1080, height: 1080 }, FONTS);
    expect(out.indexOf("<style")).toBeLessThan(out.indexOf("<text"));
  });

  it("sets the export size, not the on-screen size", () => {
    const out = serializeCardSvg(mountedCard(), { width: 1080, height: 1920 }, FONTS);
    expect(out).toContain('width="1080"');
    expect(out).toContain('height="1920"');
    expect(out).not.toContain('width="270"');
    expect(out).toContain('viewBox="0 0 1080 1080"');
  });

  it("pins the direction to left-to-right even inside a right-to-left page", () => {
    const out = serializeCardSvg(mountedCard(), { width: 1080, height: 1080 }, FONTS);
    expect(out).toContain('direction="ltr"');
    expect(out).toContain("direction:ltr");
    expect(out).not.toContain("css-injected-by-react-native-web");
  });

  it("works on a copy: the mounted card is left as it was", () => {
    const card = mountedCard();
    serializeCardSvg(card, { width: 1080, height: 1080 }, FONTS);
    expect(card.getAttribute("width")).toBe("270");
    expect(card.querySelector("style")).toBeNull();
    expect(card.getAttribute("class")).toBe("css-injected-by-react-native-web");
  });
});

describe("base64ToPngFile", () => {
  it("rebuilds the bytes as a png File without waiting on anything", () => {
    // "PNG" signature bytes 89 50 4E 47 as base64.
    const file = base64ToPngFile("iVBORw==", "bumelerze-x-square.png");
    expect(file.name).toBe("bumelerze-x-square.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
  });
});
