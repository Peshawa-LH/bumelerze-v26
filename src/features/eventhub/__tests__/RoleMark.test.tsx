import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { RoleMark } from "../components/RoleMark";

describe("RoleMark", () => {
  it("shows the official account's mark as the Bumelerze icon, with no text", async () => {
    const official = i18n.t("eventHub.roles.official");
    await render(<RoleMark roles={[{ role: "official", orgName: "Bumelerze" }]} />);
    expect(screen.getByTestId("role-mark-official-icon")).toBeTruthy();
    expect(screen.queryByText(official)).toBeNull();
    expect(screen.getByLabelText(official)).toBeTruthy();
  });

  it("shows other roles as an icon only, named for screen readers", async () => {
    const moderator = i18n.t("eventHub.roles.moderator");
    await render(<RoleMark roles={[{ role: "moderator", orgName: null }]} />);
    expect(screen.getByTestId("role-mark-moderator")).toBeTruthy();
    expect(screen.queryByText(moderator)).toBeNull();
    expect(screen.getByLabelText(moderator)).toBeTruthy();
  });

  it("shows nothing for a plain account", async () => {
    await render(<RoleMark roles={[]} />);
    expect(screen.queryByTestId(/role-mark/)).toBeNull();
  });
});
