import ar from "../locales/ar.json";
import ckb from "../locales/ckb.json";
import en from "../locales/en.json";
import kmr from "../locales/kmr.json";
import { flattenKeys } from "../locale-keys";

describe("locale catalogs", () => {
  const catalogs = { en, ckb, kmr, ar } as const;

  it("loads all four locale catalogs", () => {
    for (const catalog of Object.values(catalogs)) {
      expect(catalog).toBeTruthy();
      expect(typeof catalog).toBe("object");
    }
  });

  it("gives every locale the exact same key set as the English source of truth", () => {
    const sourceKeys = flattenKeys(en);
    expect(sourceKeys.length).toBeGreaterThan(0);

    for (const [locale, catalog] of Object.entries(catalogs)) {
      if (locale === "en") continue;
      expect(flattenKeys(catalog)).toEqual(sourceKeys);
    }
  });

  it("marks every non-English catalog as a machine-drafted status pending native review", () => {
    expect(en._status).toBe("source");
    expect(ckb._status).toBe("draft-machine");
    expect(kmr._status).toBe("draft-machine");
    expect(ar._status).toBe("draft-machine");
  });
});
