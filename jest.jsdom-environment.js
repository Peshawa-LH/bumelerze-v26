/**
 * jsdom for the web tests (`@jest-environment ./jest.jsdom-environment.js`).
 *
 * React Native 0.88's Jest setup (`@react-native/jest-preset/jest/setup.js`,
 * loaded by the jest-expo preset) runs `Object.defineProperties(global, {
 * window: { configurable: true, value: global, ... } })`. jsdom 30 makes
 * `window` a fixed property of its global, so that call throws "Cannot
 * redefine property: window" before a single test runs. In jsdom `window` is
 * already the global itself, which is all the setup wants, so this
 * environment leaves `window` out of that one call and passes everything
 * else through unchanged.
 */
const { TestEnvironment } = require("jest-environment-jsdom");

class JsdomWithReactNativeSetup extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    const scope = this.global;
    const defineProperties = scope.Object.defineProperties;
    scope.Object.defineProperties = function (target, properties) {
      if (target === scope && properties && Object.hasOwn(properties, "window")) {
        const current = Object.getOwnPropertyDescriptor(scope, "window");
        if (current && !current.configurable) {
          const { window: _alreadyTheGlobal, ...rest } = properties;
          return defineProperties.call(this, target, rest);
        }
      }
      return defineProperties.call(this, target, properties);
    };
  }
}

module.exports = JsdomWithReactNativeSetup;
