import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  cleanNote,
  normalizeReason,
  reasonLabel,
  reasonsFor,
} from "../reasons";
import i18n from "@/i18n";

describe("report reasons", () => {
  it("is one list of seven, in the agreed order", () => {
    expect(REPORT_REASONS).toEqual([
      "spam",
      "abuse_harassment",
      "rumour_prediction",
      "private_info",
      "sexual_violent",
      "impersonation",
      "other",
    ]);
  });

  it("offers impersonation for profiles only", () => {
    expect(reasonsFor("profile")).toContain("impersonation");
    expect(reasonsFor("comment")).not.toContain("impersonation");
    expect(reasonsFor("post")).not.toContain("impersonation");
    expect(reasonsFor("comment")).toEqual(reasonsFor("post"));
    expect(reasonsFor("comment")).toHaveLength(6);
  });

  it("reads the earlier words as the new ones, and nothing else", () => {
    expect(normalizeReason("abuse")).toBe("abuse_harassment");
    expect(normalizeReason("false")).toBe("rumour_prediction");
    expect(normalizeReason("private")).toBe("private_info");
    expect(normalizeReason("spam")).toBe("spam");
    expect(normalizeReason("sexual_violent")).toBe("sexual_violent");
    expect(normalizeReason("nonsense")).toBeNull();
    expect(normalizeReason(null)).toBeNull();
    expect(normalizeReason("")).toBeNull();
  });

  it("words every reason, also an earlier one, in all four languages without a raw key", async () => {
    for (const locale of ["en", "ckb", "kmr", "ar"]) {
      const t = i18n.getFixedT(locale);
      for (const reason of [...REPORT_REASONS, "abuse", "false", "private"]) {
        const label = reasonLabel(t, reason);
        expect(label.length).toBeGreaterThan(1);
        expect(label).not.toMatch(/^report\./);
      }
    }
    expect(reasonLabel(i18n.getFixedT("en"), "rumour_prediction")).toBe(
      "Fake earthquake prediction or rumour",
    );
    expect(reasonLabel(i18n.getFixedT("en"), "false")).toBe(
      "Fake earthquake prediction or rumour",
    );
    expect(reasonLabel(i18n.getFixedT("en"), "mystery")).toBe("mystery");
  });
});

describe("cleanNote", () => {
  it("trims, drops an empty note and caps at 200 characters", () => {
    expect(cleanNote("  hello  ")).toBe("hello");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote("x".repeat(300))).toHaveLength(REPORT_NOTE_MAX);
    expect(REPORT_NOTE_MAX).toBe(200);
  });
});
