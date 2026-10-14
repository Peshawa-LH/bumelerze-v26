/**
 * @jest-environment jsdom
 *
 * `a11yState` on the web must end up as real `aria-*` attributes in the DOM
 * (review B-4: react-native-web drops `accessibilityState`), so this test
 * renders through react-native-web into a jsdom document and reads the
 * attributes back. On the phone the helper is exactly `accessibilityState`.
 */
import { act, type ComponentType, type ReactElement } from "react";
import { Platform } from "react-native";

import { a11yState } from "../a11y-state";

// Neither react-native-web nor react-dom ship types in this project; only
// `Pressable`, `View` and `createRoot` are needed here.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- untyped web renderer, test only
const { Pressable, View } = require("react-native-web") as {
  Pressable: ComponentType<Record<string, unknown>>;
  View: ComponentType<Record<string, unknown>>;
};
interface Root {
  render(element: ReactElement): void;
  unmount(): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- untyped, test only
const { createRoot } = require("react-dom/client") as {
  createRoot(container: Element): Root;
};

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setOS(originalOS);
});

async function mount(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

describe("a11yState on the web", () => {
  beforeEach(() => setOS("web"));

  it("a radio's checked state is an aria-checked attribute in the DOM", async () => {
    await mount(
      <Pressable accessibilityRole="radio" testID="r" {...a11yState({ checked: true })} />,
    );
    const radio = container.querySelector('[data-testid="r"]')!;
    expect(radio.getAttribute("role")).toBe("radio");
    expect(radio.getAttribute("aria-checked")).toBe("true");
  });

  it("an unticked checkbox says so (aria-checked=false), and disabled is announced", async () => {
    // A plain View here: react-native-web's Pressable derives aria-disabled
    // from its own `disabled` prop instead.
    await mount(
      <View
        accessibilityRole="checkbox"
        testID="c"
        {...a11yState({ checked: false, disabled: true })}
      />,
    );
    const box = container.querySelector('[data-testid="c"]')!;
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.getAttribute("aria-disabled")).toBe("true");
  });

  it("expanded and selected map to aria-expanded and aria-selected", async () => {
    await mount(
      <>
        <Pressable testID="e" {...a11yState({ expanded: true })} />
        <Pressable accessibilityRole="tab" testID="s" {...a11yState({ selected: true })} />
      </>,
    );
    expect(container.querySelector('[data-testid="e"]')!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(container.querySelector('[data-testid="s"]')!.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("states that were not given add no attribute", async () => {
    await mount(<Pressable testID="n" {...a11yState({ checked: true })} />);
    const node = container.querySelector('[data-testid="n"]')!;
    expect(node.hasAttribute("aria-expanded")).toBe(false);
    expect(node.hasAttribute("aria-selected")).toBe(false);
  });

  it("'mixed' is passed through for a partly ticked checkbox", () => {
    expect(a11yState({ checked: "mixed" })["aria-checked"]).toBe("mixed");
  });
});

describe("a11yState on the phone", () => {
  it("is only accessibilityState: no aria props are added", () => {
    setOS("ios");
    const props = a11yState({ checked: true, expanded: false });
    expect(props).toEqual({ accessibilityState: { checked: true, expanded: false } });
  });
});
