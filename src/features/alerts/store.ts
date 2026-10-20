import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * What the phone app registered (iOS/Android, Expo push). The web never
 * sets these.
 */
export interface PhoneAlertDevice {
  /** The Expo push token the server has for this phone. */
  token: string;
  /** Its push_subscriptions id (marks "This device" in the device list). */
  subscriptionId: string | null;
  /** The account it was registered for: after a sign-out, or a sign-in as
   * someone else, the phone is registered again for the new one or
   * released (phone-sync.ts). */
  userId: string | null;
  locale: string;
}

/**
 * What this device remembers about alerts: whether alerts are on HERE (the
 * root layout keeps the server's copy of my alert places current only then,
 * so nobody else makes a single extra request) and the last preferences the
 * server confirmed.
 */
export interface AlertDeviceState {
  deviceOn: boolean;
  endpoint: string | null;
  /** Language the server has for this device (push_subscriptions.locale):
   * a push is worded in it, so a change of app language re-registers. */
  locale: string | null;
  /** Key of the last preferences the server saved (see prefs-sync.ts). */
  syncedKey: string | null;
  /** iOS/Android only (null on the web): the phone's registration. */
  expoToken: string | null;
  subscriptionId: string | null;
  userId: string | null;
  /** iOS/Android: a token still to be removed from the server (alerts were
   * turned off while offline). An Expo token keeps working after the app
   * forgets it, unlike a browser subscription, so the removal is retried. */
  pendingRemoval: string | null;
  setDevice: (on: boolean, endpoint: string | null, locale?: string | null) => void;
  setSyncedKey: (key: string | null) => void;
  /** iOS/Android: alerts on with this registration, or off (null). */
  setPhoneDevice: (device: PhoneAlertDevice | null) => void;
  setPendingRemoval: (token: string | null) => void;
}

export const useAlertDeviceStore = create<AlertDeviceState>()(
  persist(
    (set) => ({
      deviceOn: false,
      endpoint: null,
      locale: null,
      syncedKey: null,
      expoToken: null,
      subscriptionId: null,
      userId: null,
      pendingRemoval: null,
      setDevice: (deviceOn, endpoint, locale = null) =>
        set(
          deviceOn
            ? { deviceOn, endpoint, locale }
            : { deviceOn, endpoint, locale: null, syncedKey: null },
        ),
      setSyncedKey: (syncedKey) => set({ syncedKey }),
      setPhoneDevice: (device) =>
        set(
          device
            ? {
                deviceOn: true,
                endpoint: null,
                locale: device.locale,
                expoToken: device.token,
                subscriptionId: device.subscriptionId,
                userId: device.userId,
              }
            : {
                deviceOn: false,
                endpoint: null,
                locale: null,
                syncedKey: null,
                expoToken: null,
                subscriptionId: null,
                userId: null,
              },
        ),
      setPendingRemoval: (pendingRemoval) => set({ pendingRemoval }),
    }),
    {
      name: "bumelerze-alert-device",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        deviceOn: state.deviceOn,
        endpoint: state.endpoint,
        locale: state.locale,
        syncedKey: state.syncedKey,
        expoToken: state.expoToken,
        subscriptionId: state.subscriptionId,
        userId: state.userId,
        pendingRemoval: state.pendingRemoval,
      }),
    },
  ),
);
