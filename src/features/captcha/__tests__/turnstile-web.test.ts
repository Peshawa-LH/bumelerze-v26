import { TURNSTILE_SCRIPT_URL } from "../config";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

import {
  __resetTurnstileScriptForTests,
  loadTurnstileScript,
  type TurnstileApi,
  type TurnstileScriptEnvironment,
} from "../turnstile-script.web";
import { mountTurnstileWidget } from "../turnstile-widget";

/**
 * Web side of A1.4: Cloudflare's script is fetched only when a frame asks
 * for it (never with the first page), once, and a failed load is tried
 * again next time; one widget gives exactly one outcome.
 */

type FakeScript = {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove: jest.Mock;
};

function fakeApi(): TurnstileApi & { render: jest.Mock; remove: jest.Mock } {
  return {
    render: jest.fn(() => "widget-1"),
    remove: jest.fn(),
  };
}

function fakeEnvironment(initialApi: TurnstileApi | null = null) {
  let api = initialApi;
  const scripts: FakeScript[] = [];
  const environment: TurnstileScriptEnvironment = {
    getApi: () => api,
    createScript: () => {
      const script: FakeScript = {
        src: "",
        async: false,
        onload: null,
        onerror: null,
        remove: jest.fn(),
      };
      return script;
    },
    appendScript: (script) => {
      scripts.push(script as FakeScript);
    },
  };
  return {
    environment,
    scripts,
    arrive: (next: TurnstileApi) => {
      api = next;
    },
  };
}

beforeEach(() => {
  __resetTurnstileScriptForTests();
});

describe("loadTurnstileScript", () => {
  it("adds Cloudflare's script once, explicit rendering, and resolves with its API", async () => {
    const env = fakeEnvironment();
    const first = loadTurnstileScript(env.environment);
    const second = loadTurnstileScript(env.environment);
    expect(env.scripts).toHaveLength(1);
    expect(env.scripts[0]!.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(TURNSTILE_SCRIPT_URL).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    );
    expect(env.scripts[0]!.async).toBe(true);

    const api = fakeApi();
    env.arrive(api);
    env.scripts[0]!.onload?.();
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it("uses the API at once when the script is already there", async () => {
    const api = fakeApi();
    const env = fakeEnvironment(api);
    await expect(loadTurnstileScript(env.environment)).resolves.toBe(api);
    expect(env.scripts).toHaveLength(0);
  });

  it("a blocked or failed load rejects, removes its tag, and the next call tries again", async () => {
    const env = fakeEnvironment();
    const first = loadTurnstileScript(env.environment);
    env.scripts[0]!.onerror?.();
    await expect(first).rejects.toThrow(/failed to load/);
    expect(env.scripts[0]!.remove).toHaveBeenCalled();

    const second = loadTurnstileScript(env.environment);
    expect(env.scripts).toHaveLength(2);
    const api = fakeApi();
    env.arrive(api);
    env.scripts[1]!.onload?.();
    await expect(second).resolves.toBe(api);
  });

  it("a script that loads without its API (a captive portal page) is a failure", async () => {
    const env = fakeEnvironment();
    const attempt = loadTurnstileScript(env.environment);
    env.scripts[0]!.onload?.();
    await expect(attempt).rejects.toThrow(/without its API/);
  });
});

describe("mountTurnstileWidget", () => {
  const KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;
  const container = { nodeName: "DIV" };

  function mount(appearance: "interaction-only" | "always" = "interaction-only") {
    const api = fakeApi();
    const handlers = {
      onToken: jest.fn(),
      onFailure: jest.fn(),
      onInteractive: jest.fn(),
    };
    const unmount = mountTurnstileWidget(
      api,
      container,
      { siteKey: KEY, language: "en", theme: "light", appearance },
      handlers,
    );
    const params = api.render.mock.calls[0]?.[1] as Record<string, unknown>;
    const call = (name: string, ...args: unknown[]) =>
      (params[name] as (...a: unknown[]) => unknown)(...args);
    return { api, handlers, unmount, params, call };
  }

  it("draws an invisible-unless-needed widget: one try, no form field", () => {
    const { api, params } = mount();
    expect(api.render).toHaveBeenCalledWith(container, expect.any(Object));
    expect(params).toMatchObject({
      sitekey: KEY,
      appearance: "interaction-only",
      execution: "render",
      retry: "never",
      "refresh-expired": "never",
      "response-field": false,
      language: "en",
      theme: "light",
    });
  });

  it("hands over the token once", () => {
    const { handlers, call } = mount();
    call("callback", "tok-1");
    call("callback", "tok-2");
    call("error-callback", "x");
    expect(handlers.onToken).toHaveBeenCalledTimes(1);
    expect(handlers.onToken).toHaveBeenCalledWith("tok-1");
    expect(handlers.onFailure).not.toHaveBeenCalled();
  });

  it("errors, expiry and time-outs are a failure (the error counts as handled)", () => {
    const failing = mount();
    expect(failing.call("error-callback", "300030")).toBe(true);
    expect(failing.handlers.onFailure).toHaveBeenCalledTimes(1);

    const expired = mount();
    expired.call("expired-callback");
    expect(expired.handlers.onFailure).toHaveBeenCalledTimes(1);

    const slow = mount();
    slow.call("timeout-callback");
    expect(slow.handlers.onFailure).toHaveBeenCalledTimes(1);
  });

  it("asks for the sheet when a tap is needed, but never from the sheet itself", () => {
    const hidden = mount();
    hidden.call("before-interactive-callback");
    expect(hidden.handlers.onInteractive).toHaveBeenCalledTimes(1);

    const visible = mount("always");
    expect(visible.params.size).toBe("flexible");
    visible.call("before-interactive-callback");
    expect(visible.handlers.onInteractive).not.toHaveBeenCalled();
  });

  it("removes the widget on clean-up; a late callback then does nothing", () => {
    const { api, handlers, unmount, call } = mount();
    unmount();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    call("callback", "late");
    expect(handlers.onToken).not.toHaveBeenCalled();
  });

  it("no container, or a render that throws or returns no id: a failure, never a crash", () => {
    const handlers = {
      onToken: jest.fn(),
      onFailure: jest.fn(),
      onInteractive: jest.fn(),
    };
    const options = {
      siteKey: KEY,
      language: "auto",
      theme: "dark",
      appearance: "interaction-only",
    } as const;
    mountTurnstileWidget(fakeApi(), null, options, handlers);
    expect(handlers.onFailure).toHaveBeenCalledTimes(1);

    const throwing = fakeApi();
    throwing.render.mockImplementation(() => {
      throw new Error("bad sitekey");
    });
    const second = { onToken: jest.fn(), onFailure: jest.fn(), onInteractive: jest.fn() };
    mountTurnstileWidget(throwing, container, options, second);
    expect(second.onFailure).toHaveBeenCalledTimes(1);

    const noId = fakeApi();
    noId.render.mockReturnValue(undefined);
    const third = { onToken: jest.fn(), onFailure: jest.fn(), onInteractive: jest.fn() };
    mountTurnstileWidget(noId, container, options, third);
    expect(third.onFailure).toHaveBeenCalledTimes(1);
  });
});
