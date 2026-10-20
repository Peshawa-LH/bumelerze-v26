/**
 * iOS/Android: React Query follows the phone's connection
 * (`followDeviceConnectivity`, fed by NetInfo in the app). Before, an app
 * opened without signal assumed "online", retried into failure and never
 * refetched when the signal came back.
 */
import { onlineManager, QueryClient } from "@tanstack/react-query";

import {
  createEventsQueryClient,
  followDeviceConnectivity,
  onConnectionRegained,
} from "../queries";

function fakeConnectivity() {
  let listener: ((isConnected: boolean | null) => void) | null = null;
  const subscribe = jest.fn((onChange: (isConnected: boolean | null) => void) => {
    listener = onChange;
    return () => {
      listener = null;
    };
  });
  return {
    subscribe,
    emit(isConnected: boolean | null) {
      listener?.(isConnected);
    },
  };
}

afterEach(() => {
  onlineManager.setOnline(true);
});

it("says offline as soon as the phone has no connection, and online again when it has", () => {
  const connectivity = fakeConnectivity();
  followDeviceConnectivity(connectivity.subscribe);
  connectivity.emit(false);
  expect(onlineManager.isOnline()).toBe(false);
  connectivity.emit(true);
  expect(onlineManager.isOnline()).toBe(true);
});

it("counts a connection not yet known as online, so the first fetch is never held back", () => {
  const connectivity = fakeConnectivity();
  followDeviceConnectivity(connectivity.subscribe);
  connectivity.emit(false);
  connectivity.emit(null);
  expect(onlineManager.isOnline()).toBe(true);
});

it("pauses a fetch while offline instead of failing it, and runs it when the signal returns", async () => {
  const connectivity = fakeConnectivity();
  followDeviceConnectivity(connectivity.subscribe);
  connectivity.emit(false);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // As the app's QueryClientProvider does: the client listens for "online".
  client.mount();
  const queryFn = jest.fn(async () => "feed");
  const pending = client.fetchQuery({ queryKey: ["events", "region"], queryFn });
  await Promise.resolve();
  expect(queryFn).not.toHaveBeenCalled();
  expect(client.getQueryState(["events", "region"])?.fetchStatus).toBe("paused");

  connectivity.emit(true);
  await expect(pending).resolves.toBe("feed");
  expect(queryFn).toHaveBeenCalledTimes(1);
  client.unmount();
  client.clear();
});

it("reports a regained connection only after it was lost", () => {
  const onReconnect = jest.fn();
  const stop = onConnectionRegained(onReconnect);
  onlineManager.setOnline(true);
  expect(onReconnect).not.toHaveBeenCalled();
  onlineManager.setOnline(false);
  expect(onReconnect).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
  expect(onReconnect).toHaveBeenCalledTimes(1);
  stop();
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  expect(onReconnect).toHaveBeenCalledTimes(1);
});

it("wires the app's query client to the phone's connection on iOS/Android", () => {
  const connectivity = fakeConnectivity();
  const client = createEventsQueryClient({ deviceConnectivity: connectivity.subscribe });
  expect(connectivity.subscribe).toHaveBeenCalledTimes(1);
  connectivity.emit(false);
  expect(onlineManager.isOnline()).toBe(false);
  client.clear();
});
