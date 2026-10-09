import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * What this device remembers about alerts: whether alerts are on HERE (the
 * root layout keeps the server's copy of my alert places current only then,
 * so nobody else makes a single extra request) and the last preferences the
 * server confirmed.
 */
export interface AlertDeviceState {
  deviceOn: boolean;
  endpoint: string | null;
  /** Key of the last preferences the server saved (see prefs-sync.ts). */
  syncedKey: string | null;
  setDevice: (on: boolean, endpoint: string | null) => void;
  setSyncedKey: (key: string | null) => void;
}

export const useAlertDeviceStore = create<AlertDeviceState>()(
  persist(
    (set) => ({
      deviceOn: false,
      endpoint: null,
      syncedKey: null,
      setDevice: (deviceOn, endpoint) =>
        set(deviceOn ? { deviceOn, endpoint } : { deviceOn, endpoint, syncedKey: null }),
      setSyncedKey: (syncedKey) => set({ syncedKey }),
    }),
    {
      name: "bumelerze-alert-device",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        deviceOn: state.deviceOn,
        endpoint: state.endpoint,
        syncedKey: state.syncedKey,
      }),
    },
  ),
);
