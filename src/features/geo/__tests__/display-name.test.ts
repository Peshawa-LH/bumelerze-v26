import { displayPlaceName } from "../display-name";
import { GAZETTEER_CITIES, pickLocalizedName } from "../gazetteer";

describe("Hawler display name", () => {
  const city = GAZETTEER_CITIES.find((candidate) => candidate.id === "erbil");

  it("keeps the stored id 'erbil' while English shows Hawler", () => {
    expect(city).toBeDefined();
    expect(city?.id).toBe("erbil");
    expect(pickLocalizedName(city!.names, "en")).toBe("Hawler");
  });

  it("keeps the Kurmanji, Sorani and Arabic names", () => {
    expect(pickLocalizedName(city!.names, "kmr")).toBe("Hewlêr");
    expect(pickLocalizedName(city!.names, "ckb")).toBe("هەولێر");
    expect(pickLocalizedName(city!.names, "ar")).toBe("أربيل");
  });
});

describe("displayPlaceName", () => {
  it("rewrites the English 'Erbil' coming from provider data, per locale", () => {
    expect(displayPlaceName("Erbil", "en")).toBe("Hawler");
    expect(displayPlaceName("Markaz Erbil", "en")).toBe("Markaz Hawler");
    expect(displayPlaceName("Erbil", "kmr")).toBe("Hewlêr");
    expect(displayPlaceName("Erbil", "ckb")).toBe("هەولێر");
    expect(displayPlaceName("Erbil", "ar")).toBe("أربيل");
  });

  it("leaves every other name untouched", () => {
    expect(displayPlaceName("Sulaymaniyah", "en")).toBe("Sulaymaniyah");
    expect(displayPlaceName("هەولێر", "ckb")).toBe("هەولێر");
  });
});
