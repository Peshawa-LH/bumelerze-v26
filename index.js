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
import { Platform } from "react-native";

import "expo-router/entry";

if (Platform.OS === "web") {
  require("expo-sqlite");
  require("@babel/runtime/helpers/classPrivateFieldLooseBase");
  require("@babel/runtime/helpers/classPrivateFieldLooseKey");
}
