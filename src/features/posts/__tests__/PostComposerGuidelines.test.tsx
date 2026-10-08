import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { CommunityError } from "@/features/community/types";

import { PostComposer } from "../components/PostComposer";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: jest.fn(async () => undefined),
}));

async function setup(onSubmit: jest.Mock, accept = jest.fn(async () => undefined)) {
  await renderWithProviders(
    <PostComposer onSubmit={onSubmit} guidelinesTransport={{ accept }} />,
  );
  return { accept };
}

async function typeAndPost(text: string) {
  await fireEvent.changeText(screen.getByTestId("post-composer-input"), text);
  await fireEvent.press(screen.getByTestId("post-composer-post"));
}

describe("PostComposer + community guidelines", () => {
  afterEach(cleanup);

  it("shows the guidelines on the first post, then sends the same post again after I agree", async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new CommunityError("guidelines_required"))
      .mockResolvedValueOnce(undefined);
    const { accept } = await setup(onSubmit);
    await typeAndPost("A note from Erbil");
    expect(await screen.findByTestId("guidelines-sheet")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("guidelines-sheet-age"));
    await fireEvent.press(screen.getByTestId("guidelines-sheet-agree"));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("prompt"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenLastCalledWith("A note from Erbil");
    await waitFor(() =>
      expect(screen.getByTestId("post-composer-input").props.value).toBe(""),
    );
  });

  it("keeps the text and stays quiet when the guidelines are not accepted", async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValue(new CommunityError("guidelines_required"));
    await setup(onSubmit);
    await typeAndPost("Not yet");
    await screen.findByTestId("guidelines-sheet");
    await fireEvent.press(screen.getByTestId("guidelines-sheet-close"));
    await waitFor(() => expect(screen.queryByTestId("guidelines-sheet")).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("post-composer-input").props.value).toBe("Not yet");
    expect(screen.queryByTestId("post-composer-error")).toBeNull();
  });

  it("words other failures as before", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new CommunityError("rate_limited"));
    await setup(onSubmit);
    await typeAndPost("Again");
    expect(await screen.findByTestId("post-composer-error")).toBeTruthy();
    expect(screen.queryByTestId("guidelines-sheet")).toBeNull();
  });
});
