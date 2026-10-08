// ScrollAwareTabBar is deliberately not re-exported here: it imports expo-router's
// tab navigator, which screens (and their tests) importing the hook must not pay for.
export { useTabBarStore } from "./store";
export { useKeepTabBarVisible, useTabBarScroll } from "./use-tab-bar-scroll";
