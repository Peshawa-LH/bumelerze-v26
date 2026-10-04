import { render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { ROLE_BADGES, ROLE_PRIORITY } from "@/features/badges/catalog";

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

  it("draws at 18 by default and at 20 beside an account name", async () => {
    const view = await render(<RoleMark roles={[{ role: "engineer", orgName: null }]} />);
    expect(screen.getByTestId("role-mark-engineer").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 18, height: 18 })]),
    );
    await view.rerender(
      <RoleMark size={20} roles={[{ role: "engineer", orgName: null }]} />,
    );
    expect(screen.getByTestId("role-mark-engineer").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 20, height: 20 })]),
    );
  });

  it("reads its icon and tone from the badge catalogue, so the two cannot drift", async () => {
    const view = await render(<RoleMark roles={[{ role: "official", orgName: null }]} />);
    for (const kind of ROLE_PRIORITY) {
      await view.rerender(<RoleMark roles={[{ role: kind, orgName: null }]} />);
      expect(screen.getByTestId(`role-mark-${kind}`)).toBeTruthy();
      expect(ROLE_BADGES[kind]).toBeDefined();
    }
  });

  it("marks the top role when several are held (official > moderator > engineer > partner)", async () => {
    await render(
      <RoleMark
        roles={[
          { role: "partner", orgName: "Acme" },
          { role: "engineer", orgName: null },
        ]}
      />,
    );
    expect(screen.getByTestId("role-mark-engineer")).toBeTruthy();
    expect(screen.queryByTestId("role-mark-partner")).toBeNull();
  });

  it("shows nothing for a plain account", async () => {
    await render(<RoleMark roles={[]} />);
    expect(screen.queryByTestId(/role-mark/)).toBeNull();
  });
});
