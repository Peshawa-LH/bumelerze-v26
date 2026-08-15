jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-image crashes on bare import under jest-expo's `expo-modules-core` mock:
// `observe.ts` calls `requireOptionalNativeModule('ExpoObserve')`, jest-expo's
// module-mocking hack (jest-expo/src/preset/setup.js `requireMockModule`) can't
// find a matching `mocks/ExpoObserve.js` for that optional module (there is no
// `expo-observe` package installed, and expo-image ships no such mock itself),
// so it falls through to the real `expo-modules-core` implementation and
// crashes with `TypeError: observe.getIntegrations is not a function`.
// Confirmed still present on the newest available SDK 57 pair as of this wave
// (expo-image 57.0.3, jest-expo 57.0.4 — both latest 57.x releases; no
// changelog fix exists). Standing in a plain react-native `Image` here is
// sufficient for tests: components only need to render something and forward
// `source`/`testID`/accessibility props, never assert on real decoding.
jest.mock("expo-image", () => {
  const React = require("react");
  const { Image: RNImage } = require("react-native");
  return {
    // eslint-disable-next-line react/display-name -- test-only mock
    Image: function Image({ contentFit, ...props }) {
      return React.createElement(RNImage, props);
    },
  };
});
