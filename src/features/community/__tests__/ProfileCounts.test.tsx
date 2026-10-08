import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { ProfileCounts } from "../components/ProfileCounts";

describe("ProfileCounts", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("is one row: Reports, Comments, Followers, Following, in that order", async () => {
    await render(<ProfileCounts reports={12} comments={9} followers={3} following={2} />);
    expect(screen.getAllByTestId("profile-counts")).toHaveLength(1);
    const keys = screen
      .getAllByTestId(/^count-/)
      .map((node) => node.props.testID as string);
    expect(keys).toEqual([
      "count-reports",
      "count-comments",
      "count-followers",
      "count-following",
    ]);
    expect(screen.queryByText("Helpful")).toBeNull();
  });

  it("leaves out a figure that is not known instead of showing a wrong zero", async () => {
    await render(
      <ProfileCounts reports={null} comments={9} followers={3} following={2} />,
    );
    expect(screen.queryByTestId("count-reports")).toBeNull();
    expect(screen.getByLabelText("Comments: 9")).toBeTruthy();
  });

  it("renders nothing when nothing is known", async () => {
    await render(<ProfileCounts />);
    expect(screen.queryByTestId("profile-counts")).toBeNull();
  });

  it("only Followers and Following are buttons", async () => {
    const open = jest.fn();
    await render(
      <ProfileCounts
        reports={1}
        comments={1}
        followers={1}
        following={1}
        onOpenFollowers={open}
        onOpenFollowing={open}
      />,
    );
    expect(screen.getByTestId("count-followers").props.accessibilityRole).toBe("button");
    expect(screen.getByTestId("count-reports").props.accessibilityRole).toBeUndefined();
  });
});
