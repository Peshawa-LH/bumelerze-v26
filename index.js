// The app's entry: Expo Router's own, plus one web-only line.
// (Expo Router "custom entry point": https://docs.expo.dev/router/installation/)
//
// Web: the offline catalogue runs SQLite in a Web Worker
// (expo-sqlite/web/worker.ts) that shares a few small modules with the app:
// expo-sqlite's message channel and two Babel helpers. The web build splits
// screens into separate files, and its splitter moves modules used by two of
// those files into a shared file the worker cannot load, so the catalogue
// failed with "Requiring unknown module". Loading them here keeps them in
// this first file, where the splitter leaves the worker's own copy alone.
// scripts/check-web-workers.mjs fails the web build if a worker ever misses
// a module again. iOS/Android: one bundle, nothing changes.
//
// Since Expo SDK 58, loading expo-sqlite on the web also schedules its worker,
// and with it the 640 KB SQLite engine, for the next turn: in 26.4.16 every
// visit to every page did that. Only the catalog needs the worker, and it
// opens its database asynchronously, which starts the worker on demand. So the
// head start is cancelled here, through expo-sqlite's own key for it
// (`catalog-first-download.test.ts` fails if expo-sqlite renames that key).
import { Platform } from "react-native";

import "expo-router/entry";

if (Platform.OS === "web") {
  require("expo-sqlite");
  const workerHeadStart = Symbol.for("expo-sqlite.webWorkerStart");
  clearTimeout(globalThis[workerHeadStart]);
  delete globalThis[workerHeadStart];
  require("@babel/runtime/helpers/classPrivateFieldLooseBase");
  require("@babel/runtime/helpers/classPrivateFieldLooseKey");
}
