import { stripBidiControls } from "../bidi-text";

/** Security audit APP-09: text people type for others (names, bios, posts,
 * comments) loses the embedding, override and isolate controls; the joiners
 * and single marks that Kurdish and Arabic need stay. Same set as the
 * server's `strip_bidi_controls` (migration 0080). */
describe("stripBidiControls", () => {
  it("removes every embedding, override and isolate control", () => {
    const controls = ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"];
    expect(stripBidiControls(`a${controls.join("")}b`)).toBe("ab");
  });

  it("turns a reversed file name back into what was typed", () => {
    expect(stripBidiControls("invoice‮fdp.exe")).toBe("invoicefdp.exe");
  });

  it("keeps ZWNJ, ZWJ, LRM and RLM", () => {
    const kept = "ئارام‌خان ‍‎‏";
    expect(stripBidiControls(kept)).toBe(kept);
  });

  it("leaves ordinary text alone", () => {
    expect(stripBidiControls("Hello, Hewlêr!")).toBe("Hello, Hewlêr!");
  });
});
