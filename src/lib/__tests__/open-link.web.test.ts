import { Linking } from "react-native";

import { openLink } from "../open-link.web";

describe("openLink on the web", () => {
  it("keeps the web's new browser tab", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    await openLink("https://bumelerze.com/privacy");
    expect(openURL).toHaveBeenCalledWith("https://bumelerze.com/privacy");
    openURL.mockRestore();
  });
});
