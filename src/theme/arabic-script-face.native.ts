import { isLoaded, loadAsync } from "expo-font";
import { useSyncExternalStore } from "react";

/**
 * iOS/Android: whether the Vazirmatn faces are registered yet.
 *
 * React Native measures a paragraph once and keeps the size, keyed on its
 * text and attributes — the family NAME, not the face actually drawn. Text
 * laid out before the font file was registered was measured in the system
 * fallback, and kept that size after Vazirmatn arrived: on a cold start of a
 * Sorani phone the tab labels, measured narrow, were drawn wide and cut to
 * "ماڵه…", "نەخ…" (2026-10-20). They fitted after a JS reload, when the faces
 * were already registered in the process.
 *
 * So the theme names the family only once the faces are in: the change of
 * attribute makes every themed text measure again. The same four faces as
 * `app/_layout.tsx` (`useFonts`); expo-font loads each name once, so both
 * wait on the same download.
 */
const FACES = {
  "Vazirmatn-Regular": require("../../assets/fonts/Vazirmatn-Regular.ttf"),
  "Vazirmatn-Medium": require("../../assets/fonts/Vazirmatn-Medium.ttf"),
  "Vazirmatn-SemiBold": require("../../assets/fonts/Vazirmatn-SemiBold.ttf"),
  "Vazirmatn-Bold": require("../../assets/fonts/Vazirmatn-Bold.ttf"),
};

function facesRegistered(): boolean {
  try {
    return Object.keys(FACES).every((name) => isLoaded(name));
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
// Already in after a JS reload (the process keeps registered fonts) or when
// the faces are embedded in the app build.
let ready = facesRegistered();
let loading = false;

function startLoading(): void {
  if (ready || loading) {
    return;
  }
  if (facesRegistered()) {
    ready = true;
    return;
  }
  loading = true;
  loadAsync(FACES).then(
    () => {
      ready = true;
      loading = false;
      listeners.forEach((listener) => listener());
    },
    () => {
      // The text stays in the system face; the next subscriber tries again.
      loading = false;
    },
  );
}

function subscribeNeeded(listener: () => void): () => void {
  listeners.add(listener);
  startLoading();
  return () => {
    listeners.delete(listener);
  };
}

function subscribeNotNeeded(): () => void {
  return () => {};
}

function getSnapshot(): boolean {
  return ready;
}

/** True once the faces can be named. `needed` is false for Latin-script
 * languages, which never use them (no download is started for them). */
export function useArabicScriptFaceReady(needed: boolean): boolean {
  return useSyncExternalStore(needed ? subscribeNeeded : subscribeNotNeeded, getSnapshot);
}
