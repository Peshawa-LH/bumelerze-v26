import { MAP_RTL_TEXT_PLUGIN_URL, MAP_WORKER_URL } from "../config";
import { ensureRTLTextPluginLoaded, loadMapLibre } from "../maplibre-loader";

const mockSetWorkerUrl = jest.fn((_url: string) => {});
const mockGetRTLTextPluginStatus = jest.fn((): string => "unavailable");
const mockSetRTLTextPlugin = jest.fn((_url: string, _lazy?: boolean): Promise<void> =>
  Promise.resolve(),
);

// `{ virtual: true }`: maplibre-gl ships ESM-only (no CJS "require"/
// "default" export condition), which Jest's default CJS module resolution
// can't resolve — same documented reason `map-web-creation.test.tsx`'s
// own `jest.mock("maplibre-gl", ...)` needs it.
jest.mock(
  "maplibre-gl",
  () => ({
    setWorkerUrl: (url: string) => mockSetWorkerUrl(url),
    getRTLTextPluginStatus: () => mockGetRTLTextPluginStatus(),
    setRTLTextPlugin: (url: string, lazy?: boolean) => mockSetRTLTextPlugin(url, lazy),
  }),
  { virtual: true },
);

describe("loadMapLibre", () => {
  beforeEach(() => {
    mockSetWorkerUrl.mockClear();
    mockGetRTLTextPluginStatus.mockClear();
    mockGetRTLTextPluginStatus.mockReturnValue("unavailable");
    mockSetRTLTextPlugin.mockClear();
    mockSetRTLTextPlugin.mockReturnValue(Promise.resolve());
  });

  it("resolves the dynamically-imported module", async () => {
    const maplibre = await loadMapLibre();
    expect(typeof maplibre.setWorkerUrl).toBe("function");
  });

  it("sets the worker URL before resolving", async () => {
    await loadMapLibre();
    expect(mockSetWorkerUrl).toHaveBeenCalledWith(MAP_WORKER_URL);
  });

  it("requests the RTL plugin (lazy) when the status is still 'unavailable'", async () => {
    await loadMapLibre();
    expect(mockSetRTLTextPlugin).toHaveBeenCalledWith(MAP_RTL_TEXT_PLUGIN_URL, true);
  });

  it("does not re-request the RTL plugin once already requested this session", async () => {
    mockGetRTLTextPluginStatus.mockReturnValue("deferred");
    await loadMapLibre();
    expect(mockSetRTLTextPlugin).not.toHaveBeenCalled();
  });
});

describe("ensureRTLTextPluginLoaded", () => {
  it("swallows a rejected setRTLTextPlugin promise rather than throwing", async () => {
    // `mockImplementation` (not `mockReturnValue`) so the rejected promise
    // is only ever constructed AS `setRTLTextPlugin(...)` is called from
    // inside `ensureRTLTextPluginLoaded` — that function chains `.catch`
    // onto it in the very same statement, so there is never a tick where
    // the rejection is genuinely unhandled (unlike pre-building the
    // rejected promise via `mockReturnValue`, which gives Node's
    // unhandledRejection detector a real window to fire in).
    const maplibre = await loadMapLibre();
    mockSetRTLTextPlugin.mockImplementation(() => Promise.reject(new Error("network down")));
    mockGetRTLTextPluginStatus.mockReturnValue("unavailable");

    expect(() => ensureRTLTextPluginLoaded(maplibre)).not.toThrow();
    // Let the swallowed rejection's microtask settle before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
