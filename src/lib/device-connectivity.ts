import NetInfo from "@react-native-community/netinfo";

/**
 * Follows the phone's connection: calls `onChange` with whether it is
 * connected (null while not yet known) now and on every change, and returns
 * the function that stops.
 */
export type DeviceConnectivitySubscribe = (
  onChange: (isConnected: boolean | null) => void,
) => () => void;

let configured = false;

/**
 * iOS/Android: the phone's own connection signal (Wi-Fi or mobile data on or
 * off, airplane mode), from NetInfo. The web has none here
 * (`device-connectivity.web.ts`): React Query follows the browser's own
 * online/offline events there.
 *
 * Only that signal: NetInfo's extra "is the internet really reachable" test,
 * a request to a Google address every minute, stays switched off. A
 * connection that is on but leads nowhere is still found by the requests
 * themselves (the feed's "offline" state after failed retries).
 */
export const subscribeToDeviceConnectivity: DeviceConnectivitySubscribe | null = (
  onChange,
) => {
  if (!configured) {
    configured = true;
    NetInfo.configure({ reachabilityShouldRun: () => false });
  }
  return NetInfo.addEventListener((state) => onChange(state.isConnected));
};
