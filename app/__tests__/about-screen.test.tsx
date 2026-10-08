import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { DATA_SOURCES, MAP_SOURCES } from "@/features/about/sources";
import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";

/**
 * About screen (owner, 2026-10-08): the brand, the version, every data and
 * map credit with its licence, the font and open-source licence, the privacy
 * policy and the trademark line — moved out of the Settings footer.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "26.1.0" } },
}));

const mockOpenURL = jest.fn();
jest.mock("expo-linking", () => ({
  openURL: (url: string) => mockOpenURL(url),
}));

const mockStackScreen = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: (props: unknown) => (mockStackScreen(props), null) },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import AboutRoute from "../about";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderScreen(ui: ReactElement) {
  return await render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

describe("About screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockOpenURL.mockClear();
    mockStackScreen.mockClear();
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    await cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("is titled About Bumelerze with a back header", async () => {
    await renderScreen(<AboutRoute />);
    const options = (
      mockStackScreen.mock.calls[0][0] as { options: Record<string, unknown> }
    ).options;
    expect(options.title).toBe("About Bumelerze");
    expect(options.headerShown).toBe(true);
    expect(typeof options.headerLeft).toBe("function");
  });

  it("shows the brand mark, its sentence and the app version", async () => {
    await renderScreen(<AboutRoute />);
    expect(screen.getByLabelText("Bumelerze")).toBeTruthy();
    expect(
      screen.getByText(
        "Bumelerze is an independent earthquake monitoring system for Kurdistan and Iraq.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Version, 26.1.0")).toBeTruthy();
  });

  it("credits every earthquake-data provider with its licence", async () => {
    await renderScreen(<AboutRoute />);
    expect(screen.getByText("USGS")).toBeTruthy();
    expect(screen.getByText(/Public domain, credit requested/)).toBeTruthy();
    expect(screen.getByText("EMSC")).toBeTruthy();
    expect(screen.getByText("GEOFON")).toBeTruthy();
    expect(
      screen.getByText(/GFZ Helmholtz Centre for Geosciences · CC BY 4\.0/),
    ).toBeTruthy();
    expect(screen.getByText("ISC")).toBeTruthy();
    expect(screen.getByText(/ISC-GEM under CC BY-SA 3\.0/)).toBeTruthy();
    expect(screen.getByText("Regional catalogue")).toBeTruthy();
  });

  it("keeps every map credit the app carries", async () => {
    await renderScreen(<AboutRoute />);
    expect(screen.getByText("OpenStreetMap")).toBeTruthy();
    expect(screen.getByText("© OpenStreetMap contributors · ODbL")).toBeTruthy();
    expect(screen.getByText("OpenFreeMap")).toBeTruthy();
    expect(screen.getByText(/© OpenMapTiles/)).toBeTruthy();
    expect(screen.getByText("MapTiler")).toBeTruthy();
    expect(screen.getByText(/© MapTiler/)).toBeTruthy();
    expect(screen.getByText("Mapzen / AWS Open Data")).toBeTruthy();
    expect(screen.getByText("Kurdish place names")).toBeTruthy();
  });

  it("names the font, the open-source licence, privacy policy and trademark", async () => {
    await renderScreen(<AboutRoute />);
    expect(screen.getByText("Vazirmatn")).toBeTruthy();
    expect(screen.getByText(/SIL Open Font License 1\.1/)).toBeTruthy();
    expect(screen.getByText("Bumelerze is open source (Apache-2.0)")).toBeTruthy();
    expect(screen.getByText("Privacy policy")).toBeTruthy();
    expect(
      screen.getByText("Bumelerze™ and its logo are trademarks of the project."),
    ).toBeTruthy();
  });

  it("opens each credit's own source or licence page", async () => {
    await renderScreen(<AboutRoute />);
    const expected: Record<string, string> = {
      "about-source-usgs":
        "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
      "about-source-emsc": "https://www.seismicportal.eu/terms.html",
      "about-source-geofon": "https://geofon.gfz.de/eqinfo/faq/",
      "about-source-osm": "https://www.openstreetmap.org/copyright",
      "about-source-maptiler": "https://www.maptiler.com/copyright/",
      "about-source-openfreemap": "https://openfreemap.org/",
      "about-font": "https://github.com/rastikerdar/vazirmatn",
      "about-open-source": "https://github.com/Peshawa-LH/bumelerze-v26",
      "about-privacy": "https://bumelerze.com/privacy.html",
    };
    for (const [testID, url] of Object.entries(expected)) {
      mockOpenURL.mockClear();
      await fireEvent.press(screen.getByTestId(testID));
      expect(mockOpenURL).toHaveBeenCalledWith(url);
    }
  });

  it("renders in Sorani Kurdish with a native-script brand name", async () => {
    await i18n.changeLanguage("ckb");
    await renderScreen(<AboutRoute />);
    expect(screen.getByText("بوومەلەرزە سەرچاوە کراوەیە (Apache-2.0)")).toBeTruthy();
    expect(screen.getByText("USGS")).toBeTruthy();
    expect(mockStackScreen.mock.calls[0][0].options.title).toBe("دەربارەی بوومەلەرزە");
  });
});

describe("About strings", () => {
  const catalogs = { en, ckb, kmr, ar } as const;

  it("has a value (and a label where the row has no proper name) in every locale", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const sources = catalog.about.sources as Record<
        string,
        { label?: string; value: string }
      >;
      for (const source of [...DATA_SOURCES, ...MAP_SOURCES]) {
        const entry = sources[source.id] ?? { value: "" };
        expect(`${locale}:${source.id}:${entry?.value ? "value" : "missing"}`).toBe(
          `${locale}:${source.id}:value`,
        );
        if (!source.name) {
          expect(`${locale}:${source.id}:${entry.label ? "label" : "missing"}`).toBe(
            `${locale}:${source.id}:label`,
          );
        }
      }
    }
  });

  it("writes the brand in native script inside Sorani and Arabic sentences", () => {
    expect(ckb.about.title).not.toMatch(/Bumelerze/);
    expect(ckb.about.openSource).not.toMatch(/Bumelerze/);
    expect(ar.about.title).not.toMatch(/Bumelerze/);
    expect(ar.about.openSource).not.toMatch(/Bumelerze/);
    expect(ckb.settings.footerVersion).not.toMatch(/Bumelerze/);
  });
});
