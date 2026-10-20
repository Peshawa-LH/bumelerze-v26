/**
 * `plugins/with-ios-scene-life-cycle.js`: the iOS 27 SDK kills an app at
 * launch ("UIScene life cycle is required for apps built with this SDK")
 * unless it uses scenes, which Expo SDK 57's template does not. The first
 * build on Xcode 27 did exactly that. These tests pin the three edits the
 * plugin makes to the generated project.
 */
interface ScenePluginModule {
  removeAppDelegateWindowStart: (contents: string) => string;
  addSceneManifest: (infoPlist: Record<string, unknown>) => Record<string, unknown>;
  SCENE_DELEGATE_SWIFT: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a plain CommonJS config plugin
const plugin = require("../with-ios-scene-life-cycle") as ScenePluginModule;

/** The relevant part of Expo SDK 57's generated AppDelegate.swift. */
const SDK57_APP_DELEGATE = `class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe("removeAppDelegateWindowStart", () => {
  it("[regression] stops AppDelegate from creating a scene-less window and starting React Native", () => {
    const out = plugin.removeAppDelegateWindowStart(SDK57_APP_DELEGATE);

    expect(out).not.toContain("UIWindow(frame:");
    expect(out).not.toContain("factory.startReactNative");
    // The factory is still built there, for the scene delegate to use.
    expect(out).toContain("reactNativeFactory = factory");
    expect(out).toContain("return super.application(application, didFinishLaunchingWithOptions:");
  });

  it("is idempotent", () => {
    const once = plugin.removeAppDelegateWindowStart(SDK57_APP_DELEGATE);
    expect(plugin.removeAppDelegateWindowStart(once)).toBe(once);
  });

  it("fails loudly when the template changed (e.g. after an SDK upgrade)", () => {
    expect(() => plugin.removeAppDelegateWindowStart("class AppDelegate {}")).toThrow(
      /remove this plugin/,
    );
  });
});

describe("addSceneManifest", () => {
  it("declares one window scene handled by SceneDelegate and keeps the other keys", () => {
    const out = plugin.addSceneManifest({ CFBundleName: "Bumelerze" });

    expect(out.CFBundleName).toBe("Bumelerze");
    expect(out.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    });
  });
});

describe("SceneDelegate.swift", () => {
  const swift = plugin.SCENE_DELEGATE_SWIFT;

  it("is the class the manifest names, and starts React Native in the scene's window", () => {
    expect(swift).toContain("@objc(SceneDelegate)");
    expect(swift).toContain("UIWindow(windowScene: windowScene)");
    expect(swift).toContain('withModuleName: "main"');
  });

  it("passes cold-start links on the way Linking.getInitialURL reads them", () => {
    expect(swift).toContain("UIApplicationLaunchOptionsURLKey");
    expect(swift).toContain("connectionOptions.urlContexts");
  });

  it("hands warm links, universal links and life-cycle changes to the app delegate", () => {
    expect(swift).toContain("openURLContexts");
    expect(swift).toContain("continue userActivity");
    for (const method of [
      "applicationDidBecomeActive",
      "applicationWillResignActive",
      "applicationWillEnterForeground",
      "applicationDidEnterBackground",
    ]) {
      expect(swift).toContain(method);
    }
  });
});
