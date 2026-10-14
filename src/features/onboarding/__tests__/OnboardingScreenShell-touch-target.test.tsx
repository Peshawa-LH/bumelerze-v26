import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

// eslint-disable-next-line import/first -- after the mock above
import { OnboardingScreenShell } from "../components/OnboardingScreenShell";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** Review A-9: the onboarding "Back" text link measured 40 x 18. */
describe("OnboardingScreenShell Back tap target", () => {
  it("is a 44 pt box", async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <OnboardingScreenShell
          step="language"
          title="Title"
          primaryLabel="Continue"
          onPrimaryPress={() => undefined}
        />
      </SafeAreaProvider>,
    );

    const back = screen.getByRole("button", { name: i18n.t("onboarding.back") });
    const style = StyleSheet.flatten(back.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });
});
