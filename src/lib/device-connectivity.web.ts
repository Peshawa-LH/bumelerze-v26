/**
 * Web: no phone connection signal to follow here. React Query listens to the
 * browser's own online/offline events, and `src/features/events/queries.ts`
 * starts from `navigator.onLine` (`device-connectivity.ts` is the
 * iOS/Android version).
 */
export type DeviceConnectivitySubscribe = (
  onChange: (isConnected: boolean | null) => void,
) => () => void;

export const subscribeToDeviceConnectivity: DeviceConnectivitySubscribe | null = null;
