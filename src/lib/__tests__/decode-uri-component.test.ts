/**
 * expo-router reads every link's query with query-string 7, which decodes it
 * with decode-uri-component. Releases before 0.5.1 can be made to spin on a
 * crafted link (GHSA-qr28-fpjm-wq7f, GHSA-vcc3-ghjq-m6fr), and query-string 7
 * accepts no fixed release, so `vendor/decode-uri-component` carries 0.5.1 as
 * CommonJS and package.json points every copy at it.
 */
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

function decoderUsedByQueryString(): (input: string) => string {
  const qsDir = path.dirname(require.resolve("query-string/package.json", { paths: [ROOT] }));
  return require(require.resolve("decode-uri-component", { paths: [qsDir] }));
}

describe("decode-uri-component (the link decoder under expo-router)", () => {
  it("query-string loads the fixed local copy", () => {
    const qsDir = path.dirname(require.resolve("query-string/package.json", { paths: [ROOT] }));
    const resolved = require.resolve("decode-uri-component", { paths: [qsDir] });
    expect(resolved).toBe(path.join(ROOT, "vendor", "decode-uri-component", "index.js"));
    expect(require(path.join(ROOT, "vendor", "decode-uri-component", "package.json")).version).toBe(
      "0.5.1",
    );
  });

  it("decodes ordinary and broken links as before", () => {
    const decode = decoderUsedByQueryString();
    expect(decode("%D8%A8%D9%88%D9%88%D9%85%DB%95%D9%84%DB%95%D8%B1%D8%B2%DB%95")).toBe(
      "بوومەلەرزە",
    );
    expect(decode("a%20b%2Fc")).toBe("a b/c");
    expect(decode("%E0%A4%A")).toBe("%E0%A4%A");
    expect(decode("x%ZZy")).toBe("x%ZZy");
    expect(decode("%C3%A5%E0%A4")).toBe("å%E0%A4");
    const qs = require(require.resolve("query-string", { paths: [ROOT] }));
    expect({ ...qs.parse("?code=BMH-7K3Q9P&q=%C3%A5&bad=%E0%A4%A") }).toEqual({
      code: "BMH-7K3Q9P",
      q: "å",
      bad: "%E0%A4%A",
    });
  });

  it("finishes a crafted link quickly (many distinct encoded runs and one broken byte)", () => {
    const decode = decoderUsedByQueryString();
    const crafted =
      Array.from({ length: 400 }, (_, i) => `${"%41".repeat(i + 1)}x`).join("") + "%E0";
    const started = Date.now();
    const out = decode(crafted);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.endsWith("x%E0")).toBe(true);
    expect(out.startsWith("AxAAx")).toBe(true);
  });
});
