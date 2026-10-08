import { render } from "@testing-library/react-native";

import MyDataRedirect from "../(tabs)/(home,map,sensor,profile,settings)/my-data";

/**
 * `/my-data` was the My account page until D79 (2026-10-08). Old links (the
 * tour, a notification, a bookmarked deep link) must still land somewhere
 * sensible: the Profile tab.
 */
const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
}));

describe("/my-data", () => {
  it("redirects to the Profile tab", async () => {
    await render(<MyDataRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith("/profile");
  });
});
