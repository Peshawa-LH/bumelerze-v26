import { GAZETTEER_CITIES, pickLocalizedName } from "../gazetteer";

describe("GAZETTEER_CITIES", () => {
  it("has between 35 and 45 entries (ui-backlog.md wave 5 item 3)", () => {
    expect(GAZETTEER_CITIES.length).toBeGreaterThanOrEqual(35);
    expect(GAZETTEER_CITIES.length).toBeLessThanOrEqual(45);
  });

  it("has unique ids", () => {
    const ids = GAZETTEER_CITIES.map((city) => city.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries all four locale names, non-empty, for every city", () => {
    for (const city of GAZETTEER_CITIES) {
      expect(city.names.en.length).toBeGreaterThan(0);
      expect(city.names.ckb.length).toBeGreaterThan(0);
      expect(city.names.kmr.length).toBeGreaterThan(0);
      expect(city.names.ar.length).toBeGreaterThan(0);
    }
  });

  it("has plausible coordinates (within a broad Middle East bounding box)", () => {
    for (const city of GAZETTEER_CITIES) {
      expect(city.lat).toBeGreaterThan(25);
      expect(city.lat).toBeLessThan(42);
      expect(city.lon).toBeGreaterThan(35);
      expect(city.lon).toBeLessThan(50);
    }
  });

  it("includes the required KRG/Iraq must-have cities", () => {
    const ids = new Set(GAZETTEER_CITIES.map((city) => city.id));
    for (const required of [
      "erbil",
      "slemani",
      "duhok",
      "halabja",
      "kirkuk",
      "zakho",
      "soran",
      "ranya",
      "koya",
      "kalar",
      "chamchamal",
      "akre",
      "dukan",
      "darbandikhan",
      "khanaqin",
      "mosul",
      "baghdad",
      "kifri",
      "penjwen",
      "qaladze",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("includes the required Iran border-region cities", () => {
    const ids = new Set(GAZETTEER_CITIES.map((city) => city.id));
    for (const required of [
      "javanrud",
      "kermanshah",
      "sarpol-e-zahab",
      "qasr-e-shirin",
      "paveh",
      "marivan",
      "baneh",
      "saqqez",
      "sanandaj",
      "urmia",
      "piranshahr",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("includes the required Turkey cities", () => {
    const ids = new Set(GAZETTEER_CITIES.map((city) => city.id));
    for (const required of ["hakkari", "sirnak", "cizre"]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("flags every Iranian and Turkish city as outside the Kurdistan Region", () => {
    for (const city of GAZETTEER_CITIES) {
      if (city.country === "IR" || city.country === "TR") {
        expect(city.inKurdistanRegion).toBe(false);
      }
    }
  });
});

describe("pickLocalizedName", () => {
  const names = { en: "Erbil", ckb: "هەولێر", kmr: "Hewlêr", ar: "أربيل" };

  it("picks the matching locale's name", () => {
    expect(pickLocalizedName(names, "ckb")).toBe("هەولێر");
    expect(pickLocalizedName(names, "ar")).toBe("أربيل");
    expect(pickLocalizedName(names, "kmr")).toBe("Hewlêr");
  });

  it("falls back to English for an unrecognized locale", () => {
    expect(pickLocalizedName(names, "fr")).toBe("Erbil");
  });
});
