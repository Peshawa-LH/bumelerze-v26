import {
  PIN_ZOOM_CLOSE,
  PIN_ZOOM_TOWN,
  canConfirmPin,
  isValidPoint,
  pinLocation,
  pinStart,
  roundPoint,
} from "../pin";

const ERBIL = { lat: 36.19, lon: 44.01 };

describe("pinStart", () => {
  it("starts at a GPS fix, close in", () => {
    const start = pinStart({ lat: 36.5, lon: 43.9, quality: "gps" }, null, ERBIL);
    expect(start).toEqual({ lat: 36.5, lon: 43.9, source: "gps", zoom: PIN_ZOOM_CLOSE });
  });

  it("starts at an earlier pin, close in", () => {
    const start = pinStart({ lat: 36.5, lon: 43.9, quality: "pin" }, null, ERBIL);
    expect(start).toMatchObject({ source: "pin", zoom: PIN_ZOOM_CLOSE });
  });

  it("starts at a chosen town, wider", () => {
    const start = pinStart(
      { lat: 35.56, lon: 45.43, quality: "town", townId: "sulaymaniyah" },
      { lat: 36.19, lon: 44.01 },
      ERBIL,
    );
    expect(start).toMatchObject({ lat: 35.56, lon: 45.43, source: "town" });
    expect(start.zoom).toBe(PIN_ZOOM_TOWN);
  });

  it("falls back to the HomeBase town, then to the default town", () => {
    expect(pinStart(null, { lat: 35.56, lon: 45.43 }, ERBIL)).toMatchObject({
      lat: 35.56,
      lon: 45.43,
      source: "homeBase",
    });
    expect(pinStart(null, { lat: null, lon: null }, ERBIL)).toMatchObject({
      ...ERBIL,
      source: "default",
    });
    expect(pinStart(null, null, ERBIL)).toMatchObject({ ...ERBIL, source: "default" });
  });

  it("ignores an invalid current point", () => {
    expect(
      pinStart({ lat: Number.NaN, lon: 44, quality: "gps" }, null, ERBIL),
    ).toMatchObject({ source: "default" });
  });
});

describe("canConfirmPin", () => {
  const townStart = pinStart(
    { lat: 36.19, lon: 44.01, quality: "town", townId: "erbil" },
    null,
    ERBIL,
  );

  it("is not allowed while the pin still sits on a town centre", () => {
    expect(canConfirmPin(townStart, { lat: 36.19, lon: 44.01 })).toBe(false);
    expect(canConfirmPin(townStart, { lat: 36.1900001, lon: 44.0100001 })).toBe(false);
  });

  it("is allowed once the pin is moved", () => {
    expect(canConfirmPin(townStart, { lat: 36.2, lon: 44.02 })).toBe(true);
  });

  it("is allowed straight away from a GPS fix or an earlier pin", () => {
    const gps = pinStart({ lat: 36.5, lon: 43.9, quality: "gps" }, null, ERBIL);
    expect(canConfirmPin(gps, { lat: 36.5, lon: 43.9 })).toBe(true);
    const pin = pinStart({ lat: 36.5, lon: 43.9, quality: "pin" }, null, ERBIL);
    expect(canConfirmPin(pin, { lat: 36.5, lon: 43.9 })).toBe(true);
  });

  it("is never allowed for an invalid point", () => {
    const gps = pinStart({ lat: 36.5, lon: 43.9, quality: "gps" }, null, ERBIL);
    expect(canConfirmPin(gps, { lat: 91, lon: 43.9 })).toBe(false);
  });
});

describe("pinLocation", () => {
  it("becomes a 'pin' quality location with the point rounded to 6 decimals", () => {
    expect(pinLocation({ lat: 36.25123449, lon: 44.01234561 })).toEqual({
      lat: 36.251234,
      lon: 44.012346,
      quality: "pin",
    });
  });
});

describe("points", () => {
  it("rounds and validates", () => {
    expect(roundPoint({ lat: 1.23456789, lon: -2.3456789 })).toEqual({
      lat: 1.234568,
      lon: -2.345679,
    });
    expect(isValidPoint({ lat: 36, lon: 44 })).toBe(true);
    expect(isValidPoint({ lat: 36, lon: 181 })).toBe(false);
    expect(isValidPoint({ lat: Infinity, lon: 0 })).toBe(false);
  });
});
