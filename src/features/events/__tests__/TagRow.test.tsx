import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  buildTagRowAccessibilityLabel,
  MAX_NAMED_SOURCE_TAGS_FULL,
  TagRow,
} from "../components/TagRow";

/**
 * Owner brief 2026-08-28: generalises the old `ProvenanceChip` + inline
 * "notable" tag pairing into one ordered tag row (source(s), notable,
 * shakemap-slot), with a combined form once the corroborating-agency list
 * runs long. Coverage explicitly asked for in the brief: one, two, three,
 * and five sources.
 *
 * Since 2026-08-28 the DEFAULT is one source tag, not three: the owner saw
 * "US EMSC GFZ" crowd a phone card and asked for one. The multi-tag cases
 * below therefore pass `maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL}`
 * explicitly, because they describe the event-detail surface rather than
 * the card.
 *
 * Every individual pill is deliberately hidden from the accessibility tree
 * (`Tag`'s own `accessibilityElementsHidden` — the row's combined label is
 * what a screen reader actually hears), so every text query below needs
 * `{ includeHiddenElements: true }` — same convention already used by
 * `ShakeMapView.test.tsx`/`FeltMapView.test.tsx`/`safety-screen.test.tsx`
 * for their own decorative-but-queryable content.
 */
const HIDDEN = { includeHiddenElements: true } as const;

describe("TagRow", () => {
  it("falls back to the single provider chip when there's no corroboration data (undefined agencies)", async () => {
    await render(<TagRow provider="usgs" />);
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
  });

  it("falls back to the single provider chip when agencies is an empty array", async () => {
    await render(<TagRow provider="emsc" agencies={[]} />);
    expect(screen.getByText("EMSC", HIDDEN)).toBeTruthy();
  });

  it("renders one named tag for one corroborating agency, even when it differs from the fetch provider", async () => {
    // The whole point of the registry: EMSC relayed AFAD's own location.
    await render(<TagRow provider="emsc" agencies={["AFAD"]} />);
    expect(screen.getByText("AFAD", HIDDEN)).toBeTruthy();
    expect(screen.queryByText("EMSC", HIDDEN)).toBeNull();
  });

  it("renders USGS's raw network code 'US' under its familiar name", async () => {
    // The registry stores what the feed reports, and USGS reports itself as
    // "US". Unmapped, the same organisation showed as "US" on a corroborated
    // card and "USGS" everywhere else, reading as two different sources.
    await render(<TagRow provider="usgs" agencies={["US"]} />);
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
    expect(screen.queryByText("US", HIDDEN)).toBeNull();
  });

  it("shows only the leading agency on a banner, never a '+N' (owner directive)", async () => {
    // A list banner carries exactly three tag kinds: source, notable,
    // shakemap. Three agencies agreeing must still render as ONE source tag.
    await render(
      <TagRow provider="usgs" agencies={["US", "CSEM", "GFZ"]} isNotable />,
    );
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
    expect(screen.queryByText("EMSC", HIDDEN)).toBeNull();
    expect(screen.queryByText("GEOFON", HIDDEN)).toBeNull();
    expect(screen.queryByText(/^\+/, HIDDEN)).toBeNull();
    expect(screen.getByText(i18n.t("events.notableTag"), HIDDEN)).toBeTruthy();
  });

  it("renders one named tag per agency for two sources", async () => {
    await render(<TagRow provider="usgs" agencies={["USGS", "EMSC"]} maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL} />);
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
    expect(screen.getByText("EMSC", HIDDEN)).toBeTruthy();
  });

  it("renders one named tag per agency for three sources, with no combined tag", async () => {
    await render(<TagRow provider="usgs" agencies={["USGS", "EMSC", "ISN"]} maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL} />);
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
    expect(screen.getByText("EMSC", HIDDEN)).toBeTruthy();
    expect(screen.getByText("ISN", HIDDEN)).toBeTruthy();
    expect(screen.queryByText(/^\+/, HIDDEN)).toBeNull();
  });

  it("collapses beyond three sources into three named tags plus a combined '+N' tag", async () => {
    await render(
      <TagRow
        provider="usgs"
        agencies={["USGS", "EMSC", "ISN", "AFAD", "NEIC"]}
        maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL}
      />,
    );
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
    expect(screen.getByText("EMSC", HIDDEN)).toBeTruthy();
    expect(screen.getByText("ISN", HIDDEN)).toBeTruthy();
    // The 4th/5th agencies aren't named individually...
    expect(screen.queryByText("AFAD", HIDDEN)).toBeNull();
    expect(screen.queryByText("NEIC", HIDDEN)).toBeNull();
    // ...they're summarized as "+2" (owner brief's own example: "three
    // named plus '+2'").
    expect(screen.getByText("+2", HIDDEN)).toBeTruthy();
  });

  it("renders the notable tag when isNotable is true", async () => {
    await render(<TagRow provider="usgs" isNotable />);
    expect(screen.getByText(i18n.t("events.notableTag"), HIDDEN)).toBeTruthy();
  });

  it("does not render a notable tag by default", async () => {
    await render(<TagRow provider="usgs" />);
    expect(screen.queryByText(i18n.t("events.notableTag"), HIDDEN)).toBeNull();
  });

  it("renders the shakemap tag only when hasShakemap is explicitly true", async () => {
    await render(<TagRow provider="usgs" />);
    expect(screen.queryByText(i18n.t("events.shakemapTag"), HIDDEN)).toBeNull();

    await render(<TagRow provider="usgs" hasShakemap />);
    expect(screen.getByText(i18n.t("events.shakemapTag"), HIDDEN)).toBeTruthy();
  });

  it("orders tags as sources, then notable, then shakemap", async () => {
    await render(
      <TagRow provider="usgs" agencies={["USGS"]} isNotable hasShakemap />,
    );
    expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
    expect(screen.getByText(i18n.t("events.notableTag"), HIDDEN)).toBeTruthy();
    expect(screen.getByText(i18n.t("events.shakemapTag"), HIDDEN)).toBeTruthy();

    // react-native-testing-library exposes host-tree order via each node's
    // parent traversal; simplest robust check here is DOM-order via
    // `toJSON()` string positions, since all three render as plain <Text>.
    const tree = JSON.stringify(screen.toJSON());
    const sourceIndex = tree.indexOf("USGS");
    const notableIndex = tree.indexOf(i18n.t("events.notableTag"));
    const shakemapIndex = tree.indexOf(i18n.t("events.shakemapTag"));

    expect(sourceIndex).toBeLessThan(notableIndex);
    expect(notableIndex).toBeLessThan(shakemapIndex);
  });

  describe("standalone accessibility", () => {
    it("exposes one combined accessible element by default (standalone)", async () => {
      await render(
        <TagRow provider="usgs" agencies={["USGS", "EMSC"]} isNotable maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL} />,
      );
      const combined = screen.getByLabelText(
        `${i18n.t("events.tagRow.sourcesA11yLabel", { agencies: "USGS, EMSC" })}. ${i18n.t("events.notableTag")}`,
      );
      expect(combined).toBeTruthy();
    });

    it("mentions the '+N more' phrasing in the combined label once the list is long", async () => {
      await render(
        <TagRow provider="usgs" agencies={["USGS", "EMSC", "ISN", "AFAD"]} maxSourceTags={MAX_NAMED_SOURCE_TAGS_FULL} />,
      );
      const expected = i18n.t("events.tagRow.sourcesWithMoreA11yLabel", {
        agencies: "USGS, EMSC, ISN",
        count: 1,
      });
      expect(screen.getByLabelText(expected)).toBeTruthy();
    });

    it("renders no standalone accessible wrapper when standalone=false, matching EventCard's own combined label pattern", async () => {
      await render(
        <TagRow provider="usgs" agencies={["USGS"]} standalone={false} />,
      );
      // The individual pill text is still present in the tree...
      expect(screen.getByText("USGS", HIDDEN)).toBeTruthy();
      // ...but nothing in this subtree carries the combined sentence as an
      // `accessibilityLabel` of its own (the parent, e.g. EventCard's
      // Pressable, owns that instead).
      expect(
        screen.queryByLabelText(
          i18n.t("events.tagRow.sourcesA11yLabel", { agencies: "USGS" }),
        ),
      ).toBeNull();
    });
  });
});

describe("buildTagRowAccessibilityLabel", () => {
  it("builds the same sentence TagRow would expose standalone, for EventCard to fold into its own label", () => {
    // A banner carries exactly three tag kinds (source, notable, shakemap)
    // and never a "+N". The spoken label matches that rather than quietly
    // adding "and 1 more", so a screen-reader user hears what a sighted
    // user sees; the full agency list lives on event detail.
    const label = buildTagRowAccessibilityLabel(
      { provider: "usgs", agencies: ["USGS", "EMSC"], isNotable: true },
      i18n.t.bind(i18n),
    );
    expect(label).toBe(
      `${i18n.t("events.tagRow.sourcesA11yLabel", { agencies: "USGS" })}. ${i18n.t("events.notableTag")}`,
    );
  });

  it("names every agency when the caller opts into the full list, as the event-detail header does", () => {
    const label = buildTagRowAccessibilityLabel(
      {
        provider: "usgs",
        agencies: ["USGS", "EMSC"],
        isNotable: true,
        maxSourceTags: MAX_NAMED_SOURCE_TAGS_FULL,
      },
      i18n.t.bind(i18n),
    );
    expect(label).toBe(
      `${i18n.t("events.tagRow.sourcesA11yLabel", { agencies: "USGS, EMSC" })}. ${i18n.t("events.notableTag")}`,
    );
  });

  it("falls back to the provider label when there's no agencies list", () => {
    const label = buildTagRowAccessibilityLabel(
      { provider: "geofon" },
      i18n.t.bind(i18n),
    );
    expect(label).toBe(
      i18n.t("events.tagRow.sourcesA11yLabel", { agencies: "GEOFON" }),
    );
  });
});
