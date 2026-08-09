import { render, screen } from "@testing-library/react-native";

import { ProvenanceChip } from "../components/ProvenanceChip";

/**
 * Provenance chip label coverage (wave brief point 3/6): only "usgs" had a
 * render assertion before this wave (home-screen.test.tsx). This confirms
 * the EMSC catalog addition (events.provenance.emsc) actually renders
 * through the same provider-namespaced key the chip has always used — no
 * component change was needed, so this test is the proof of that.
 */
describe("ProvenanceChip", () => {
  it("renders the USGS label for provider 'usgs'", async () => {
    await render(<ProvenanceChip provider="usgs" />);
    expect(screen.getByText("USGS")).toBeTruthy();
  });

  it("renders the EMSC label for provider 'emsc'", async () => {
    await render(<ProvenanceChip provider="emsc" />);
    expect(screen.getByText("EMSC")).toBeTruthy();
  });
});
