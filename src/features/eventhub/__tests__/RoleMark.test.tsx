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

  it("marks the top rank in the order seismologist > professor > researcher > engineer", async () => {
    const view = await render(
      <RoleMark
        roles={[
          { role: "engineer", orgName: null },
          { role: "researcher", orgName: null },
          { role: "professor", orgName: null },
        ]}
      />,
    );
    expect(screen.getByTestId("role-mark-professor")).toBeTruthy();
    await view.rerender(
      <RoleMark
        roles={[
          { role: "researcher", orgName: null },
          { role: "seismologist", orgName: null },
        ]}
      />,
    );
    expect(screen.getByTestId("role-mark-seismologist")).toBeTruthy();
    await view.rerender(<RoleMark roles={[{ role: "researcher", orgName: null }]} />);
    expect(screen.getByLabelText(i18n.t("eventHub.roles.researcher"))).toBeTruthy();
  });

  it("shows nothing for a plain account", async () => {
    await render(<RoleMark roles={[]} />);
    expect(screen.queryByTestId(/role-mark/)).toBeNull();
  });
});

describe("RoleMark: the official mark is single-colour, never the logo red", () => {
  const LOGO_RED = /^#c8202f$/i;

  it("draws the Bumelerze mark in one tone-derived fill inside a tinted circle", async () => {
    await render(<RoleMark roles={[{ role: "official", orgName: null }]} />);
    const circle = screen.getByTestId("role-mark-official-icon");
    // The mark is vector, so it takes the tone on web as well as native.
    const fills = JSON.stringify(circle.props.children.props);
    expect(fills).not.toMatch(LOGO_RED);
    expect(circle.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 18, height: 18 })]),
    );
  });

  it("keeps the 18 and 20 px boxes the other roles use", async () => {
    const view = await render(<RoleMark roles={[{ role: "official", orgName: null }]} />);
    expect(screen.getByTestId("role-mark-official").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 18, height: 18 })]),
    );
    await view.rerender(
      <RoleMark size={20} roles={[{ role: "official", orgName: null }]} />,
    );
    expect(screen.getByTestId("role-mark-official").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 20, height: 20 })]),
    );
  });
});
