import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { HubError } from "../types";
import { CommentComposer } from "../components/CommentComposer";
import { renderWithProviders } from "../__fixtures__/testing";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: jest.fn(async () => undefined),
}));

function setup(onSubmit: jest.Mock, accept = jest.fn(async () => undefined)) {
  return {
    accept,
    ready: renderWithProviders(
      <CommentComposer
        isAccount={false}
        placeholder="Write"
        onSubmit={onSubmit}
        guidelinesTransport={{ accept }}
      />,
    ),
  };
}

async function typeAndPost(text: string) {
  await fireEvent.changeText(screen.getByTestId("hub-composer-input"), text);
  await fireEvent.press(screen.getByTestId("hub-composer-post"));
}

describe("CommentComposer + community guidelines", () => {
  afterEach(cleanup);

  it("posts straight away when the guidelines were accepted already", async () => {
    const onSubmit = jest.fn(async () => undefined);
    const { ready } = setup(onSubmit);
    await ready;
    await typeAndPost("Felt it in Duhok");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Felt it in Duhok"));
    expect(screen.queryByTestId("guidelines-sheet")).toBeNull();
  });

  it("shows the guidelines on the first comment, then sends the same comment again after I agree", async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new HubError("guidelines_required"))
      .mockResolvedValueOnce(undefined);
    const { ready, accept } = setup(onSubmit);
    await ready;
    await typeAndPost("Strong shaking");
    expect(await screen.findByTestId("guidelines-sheet")).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId("guidelines-sheet-age"));
    await fireEvent.press(screen.getByTestId("guidelines-sheet-agree"));

    await waitFor(() => expect(accept).toHaveBeenCalledWith("prompt"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenLastCalledWith("Strong shaking");
    await waitFor(() => expect(screen.queryByTestId("guidelines-sheet")).toBeNull());
    // the box is empty again: the comment went out once
    expect(screen.getByTestId("hub-composer-input").props.value).toBe("");
  });

  it("keeps the text and shows no error when the guidelines are closed without agreeing", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new HubError("guidelines_required"));
    const { ready, accept } = setup(onSubmit);
    await ready;
    await typeAndPost("Draft words");
    await screen.findByTestId("guidelines-sheet");
    await fireEvent.press(screen.getByTestId("guidelines-sheet-later"));
    await waitFor(() => expect(screen.queryByTestId("guidelines-sheet")).toBeNull());
    expect(accept).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hub-composer-input").props.value).toBe("Draft words");
    expect(screen.queryByText(/Couldn't/)).toBeNull();
  });

  it("does not ask for the guidelines for any other failure", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new HubError("rate_limited"));
    const { ready } = setup(onSubmit);
    await ready;
    await typeAndPost("Too many");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("guidelines-sheet")).toBeNull();
  });
});
