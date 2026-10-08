import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { ReportSheet } from "../ReportSheet";

async function setup(kind: "comment" | "post" | "profile", overrides = {}) {
  const props = {
    onSubmit: jest.fn(async () => undefined),
    onSent: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  const view = await renderWithProviders(<ReportSheet kind={kind} {...props} />);
  return { props, ...view };
}

const submit = () => screen.getByTestId("report-sheet-submit");

describe("ReportSheet", () => {
  afterEach(async () => {
    cleanup();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  it.each([
    ["comment", "Report this comment"],
    ["post", "Report this post"],
    ["profile", "Report this profile"],
  ] as const)("titles the %s sheet", async (kind, title) => {
    await setup(kind);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("lists six reasons for a comment or post", async () => {
    await setup("comment");
    expect(screen.getAllByTestId(/^report-sheet-reason-/)).toHaveLength(6);
    expect(screen.queryByTestId("report-sheet-reason-impersonation")).toBeNull();
  });

  it("lists seven reasons for a profile, impersonation included", async () => {
    await setup("profile");
    expect(screen.getAllByTestId(/^report-sheet-reason-/)).toHaveLength(7);
    expect(screen.getByTestId("report-sheet-reason-impersonation")).toBeTruthy();
    expect(screen.getByText("Fake earthquake prediction or rumour")).toBeTruthy();
    expect(screen.getByText("Sexual or violent content")).toBeTruthy();
  });

  it("sends nothing until a reason is chosen", async () => {
    const { props } = await setup("comment");
    expect(submit().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(submit());
    expect(props.onSubmit).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("report-sheet-reason-spam"));
    expect(submit().props.accessibilityState.disabled).toBe(false);
  });

  it("sends the reason with a trimmed note, then reports it sent and closes", async () => {
    const { props } = await setup("comment");
    await fireEvent.press(screen.getByTestId("report-sheet-reason-rumour_prediction"));
    await fireEvent.changeText(
      screen.getByTestId("report-sheet-note"),
      "  a bigger one tonight ",
    );
    await fireEvent.press(submit());
    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith({
        reason: "rumour_prediction",
        note: "a bigger one tonight",
      }),
    );
    expect(props.onSent).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("sends a missing note as null", async () => {
    const { props } = await setup("profile");
    await fireEvent.press(screen.getByTestId("report-sheet-reason-impersonation"));
    await fireEvent.press(submit());
    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith({
        reason: "impersonation",
        note: null,
      }),
    );
  });

  it("caps the note at 200 characters and shows how many are used", async () => {
    await setup("comment");
    const note = screen.getByTestId("report-sheet-note");
    expect(note.props.maxLength).toBe(200);
    await fireEvent.changeText(note, "abc");
    expect(screen.getByTestId("report-sheet-count")).toHaveTextContent(/3.*\/.*200/);
  });

  it("stays open with a message when the send fails, and can be tried again", async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const { props } = await setup("post", {
      onSubmit,
      errorText: () => "No connection.",
    });
    await fireEvent.press(screen.getByTestId("report-sheet-reason-spam"));
    await fireEvent.press(submit());
    expect(await screen.findByTestId("report-sheet-error")).toHaveTextContent(
      "No connection.",
    );
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSent).not.toHaveBeenCalled();
    await fireEvent.press(submit());
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("closes from the close button without sending", async () => {
    const { props } = await setup("comment");
    await fireEvent.press(screen.getByTestId("report-sheet-close"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it.each(["ckb", "kmr", "ar"])("renders in %s without a raw key", async (locale) => {
    await i18n.changeLanguage(locale);
    await setup("profile");
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/report\.|guidelines\./);
    expect(screen.getAllByTestId(/^report-sheet-reason-/)).toHaveLength(7);
  });
});
