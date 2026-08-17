import { shouldRequestRTLTextPlugin } from "../rtl-plugin";

describe("shouldRequestRTLTextPlugin", () => {
  it("requests the plugin when the reported status is 'unavailable' (never asked for yet)", () => {
    expect(shouldRequestRTLTextPlugin("unavailable")).toBe(true);
  });

  it.each(["deferred", "loading", "loaded", "error", "requested"])(
    "does not re-request once the status has moved past 'unavailable' (%s)",
    (status) => {
      expect(shouldRequestRTLTextPlugin(status)).toBe(false);
    },
  );
});
