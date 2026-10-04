import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { RoleMark } from "../components/RoleMark";

describe("RoleMark", () => {
  it("shows the label next to the mark", async () => {
    await render(
      <RoleMark roles={[{ role: "moderator", orgName: null }]} authorName="Shilan" />,
    );
    expect(screen.getByText(i18n.t("eventHub.roles.moderator"))).toBeTruthy();
  });

  it("shows only the mark when the label repeats the author's name", async () => {
    const official = i18n.t("eventHub.roles.official");
    await render(
      <RoleMark
        roles={[{ role: "official", orgName: "Bumelerze" }]}
        authorName={official}
      />,
    );
    expect(screen.queryByText(official)).toBeNull();
    expect(screen.getByLabelText(official)).toBeTruthy();
  });
});
