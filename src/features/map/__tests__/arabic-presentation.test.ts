import { reshapeForKurdish, toPresentationForms } from "../arabic-presentation";

const cps = (s: string) =>
  Array.from(s, (ch) =>
    (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"),
  ).join(" ");

describe("toPresentationForms", () => {
  it("leaves Latin and punctuation alone", () => {
    expect(toPresentationForms("Hewlêr (Erbil)")).toBe("Hewlêr (Erbil)");
    expect(toPresentationForms("")).toBe("");
  });

  it("joins the letter before ە, which the RTL plugin gets wrong", () => {
    // ه initial, ە base, و isolated, ل initial, ێ medial, ر final
    expect(cps(toPresentationForms("هەولێر"))).toBe("FEEB 06D5 FEED FEDF FBE7 FEAE");
    // ب initial, ە, غ initial, د final, ا isolated
    expect(cps(toPresentationForms("بەغدا"))).toBe("FE91 06D5 FECF FEAA FE8D");
  });

  it("shapes ێ in every position", () => {
    expect(cps(toPresentationForms("سلێمانی"))).toBe(
      "FEB3 FEE0 FBE7 FEE4 FE8E FEE7 FBFD",
    );
    expect(cps(toPresentationForms("ێ"))).toBe("FBE4");
    expect(cps(toPresentationForms("بێ"))).toBe("FE91 FBE5");
    expect(cps(toPresentationForms("دێ"))).toBe("FEA9 FBE4"); // د does not join left
  });

  it("draws ڵ as the matching lam form plus the small v", () => {
    // ه initial, ە, ڵ initial (lam initial + v), ە, ب initial, ج medial, ە
    expect(cps(toPresentationForms("هەڵەبجە"))).toBe(
      "FEEB 06D5 FEDF 065A 06D5 FE91 FEA0 06D5",
    );
    // ڵ after ا (which does not join left) is isolated: lam isolated + v
    expect(cps(toPresentationForms("چەمچەماڵ"))).toBe(
      "FB7C 06D5 FEE3 FB7D 06D5 FEE3 FE8E FEDD 065A",
    );
  });

  it("uses the lam-alef ligature", () => {
    expect(cps(toPresentationForms("سلا"))).toBe("FEB3 FEFC");
    expect(cps(toPresentationForms("لا"))).toBe("FEFB");
  });

  it("keeps non-joining ڕ and ۆ correct", () => {
    expect(cps(toPresentationForms("کۆیە"))).toBe("FB90 FBDA FBFE 06D5");
    expect(cps(toPresentationForms("ڕانیە"))).toBe("0695 FE8D FEE7 FBFF 06D5");
  });

  it("is idempotent", () => {
    const once = toPresentationForms("هەڵەبجە سلێمانی");
    expect(toPresentationForms(once)).toBe(once);
  });
});

describe("reshapeForKurdish", () => {
  it("undoes the plugin's shaping and redoes it with the Kurdish letters known", () => {
    // What the shipped plugin (ICU) produces for هەولێر, measured 2026-09-27:
    // isolated ه, unshaped ێ.
    const fromPlugin = String.fromCodePoint(
      0xfee9,
      0x06d5,
      0xfeed,
      0xfedf,
      0x06ce,
      0xfeae,
    );
    expect(cps(reshapeForKurdish(fromPlugin))).toBe(cps(toPresentationForms("هەولێر")));
  });

  it("undoes a lam-alef ligature before reshaping", () => {
    const fromPlugin = String.fromCodePoint(0xfeb3, 0xfefc, 0x06d5); // سلا + ە
    expect(cps(reshapeForKurdish(fromPlugin))).toBe(cps(toPresentationForms("سلاە")));
  });

  it("leaves text without a Kurdish letter exactly as the plugin shaped it", () => {
    const arabic = String.fromCodePoint(0xfe8f, 0xfecf, 0xfeaa, 0xfe8d, 0x062f);
    expect(reshapeForKurdish(arabic)).toBe(arabic);
  });
});
