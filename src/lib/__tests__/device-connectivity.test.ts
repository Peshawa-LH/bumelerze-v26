/**
 * iOS/Android: the phone's connection signal from NetInfo
 * (`src/lib/device-connectivity.ts`).
 */
import NetInfo from "@react-native-community/netinfo";

import { subscribeToDeviceConnectivity } from "../device-connectivity";

jest.mock("@react-native-community/netinfo", () =>
  jest.requireActual("@react-native-community/netinfo/jest/netinfo-mock.js"),
);

const configure = NetInfo.configure as jest.Mock;
const addEventListener = NetInfo.addEventListener as jest.Mock;

it("passes on NetInfo's connected signal and stops when asked", () => {
  const stopNetInfo = jest.fn();
  addEventListener.mockReturnValueOnce(stopNetInfo);
  const onChange = jest.fn();

  const stop = subscribeToDeviceConnectivity?.(onChange);
  const handler = addEventListener.mock.calls[0]?.[0] as (state: {
    isConnected: boolean | null;
  }) => void;
  handler({ isConnected: false });
  expect(onChange).toHaveBeenLastCalledWith(false);
  handler({ isConnected: null });
  expect(onChange).toHaveBeenLastCalledWith(null);
  handler({ isConnected: true });
  expect(onChange).toHaveBeenLastCalledWith(true);

  stop?.();
  expect(stopNetInfo).toHaveBeenCalledTimes(1);
});

it("never runs NetInfo's extra internet test (a request to Google every minute)", () => {
  expect(configure).toHaveBeenCalledTimes(1);
  const options = configure.mock.calls[0]?.[0] as {
    reachabilityShouldRun: () => boolean;
  };
  expect(options.reachabilityShouldRun()).toBe(false);
});
