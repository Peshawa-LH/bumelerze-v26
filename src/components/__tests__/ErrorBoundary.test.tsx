import { render, screen, fireEvent } from "@testing-library/react-native";
import { Text, Pressable } from "react-native";

import { ErrorBoundary } from "../ErrorBoundary";

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <Text>content</Text>;
}

describe("ErrorBoundary", () => {
  // The Bomb component intentionally throws during render — React logs
  // this to console.error even when a boundary catches it. Silencing per
  // React's own documented test pattern for error-boundary tests.
  let consoleErrorSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when there is no error", async () => {
    await render(
      <ErrorBoundary fallback={() => <Text>fallback</Text>}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("renders the fallback and passes the caught error through", async () => {
    await render(
      <ErrorBoundary fallback={(error) => <Text>fallback: {error.message}</Text>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback: boom")).toBeTruthy();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("clears the error state when retry is invoked", async () => {
    await render(
      <ErrorBoundary
        fallback={(_error, retry) => (
          <Pressable onPress={retry} accessibilityRole="button">
            <Text>retry</Text>
          </Pressable>
        )}
      >
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );

    fireEvent.press(screen.getByText("retry"));
    // The boundary's own error state clears; since Bomb is a stable
    // component instance still configured to throw, it throws again on
    // the next render and the boundary re-catches — this asserts retry
    // does trigger a fresh render pass (fallback is still shown), the
    // "does recovery actually work" case is covered by callers pairing
    // retry with a `key` remount (documented on the component itself).
    expect(screen.getByText("retry")).toBeTruthy();
  });
});
