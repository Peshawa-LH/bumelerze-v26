import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { DownloadMyDataRow } from "../components/DownloadMyDataRow";
import { deliverJsonFile } from "../deliver";
import { exportFileName, exportText, type DataExportTransport } from "../transport";

const mockWrite = jest.fn();
const mockCreate = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: jest.fn().mockImplementation((dir: string, name: string) => ({
    uri: `${dir}/${name}`,
    create: (...args: unknown[]) => mockCreate(...args),
    write: (...args: unknown[]) => mockWrite(...args),
  })),
}));
const mockShare = jest.fn(async () => undefined);
let mockAvailable = true;
jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => mockAvailable,
  shareAsync: (...args: unknown[]) => mockShare(...(args as [])),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

const DATA = { format: "bumelerze-export-1", felt_reports: [{ lat: 35.1, lon: 45.2 }] };

function transport(result: unknown | Error): jest.Mocked<DataExportTransport> {
  return {
    fetchMyData: jest.fn(async () => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }),
  };
}

describe("Download my data", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAvailable = true;
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("names the file by date and pretty-prints the JSON", () => {
    expect(exportFileName(Date.UTC(2026, 9, 9, 12))).toBe(
      "bumelerze-my-data-2026-10-09.json",
    );
    expect(exportText({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it("phone: writes the file to the cache and opens the share sheet", async () => {
    await expect(deliverJsonFile("{}", "x.json", "My data")).resolves.toBe("shared");
    expect(mockCreate).toHaveBeenCalledWith({ overwrite: true });
    expect(mockWrite).toHaveBeenCalledWith("{}");
    expect(mockShare).toHaveBeenCalledWith("file:///cache/x.json", {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "My data",
    });
  });

  it("phone without a share sheet says so", async () => {
    mockAvailable = false;
    await expect(deliverJsonFile("{}", "x.json", "t")).resolves.toBe("unavailable");
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("the row fetches the server's document and hands it over as one file", async () => {
    const deliver = jest.fn(async () => "downloaded" as const);
    const tr = transport(DATA);
    await renderWithProviders(<DownloadMyDataRow transport={tr} deliver={deliver} />);
    expect(screen.getByText("Download my data")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("data-export-row"));
    });
    expect(tr.fetchMyData).toHaveBeenCalledTimes(1);
    const [text, name, title] = deliver.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(JSON.parse(text)).toEqual(DATA);
    expect(name).toMatch(/^bumelerze-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(title).toBe("My Bumelerze data");
    expect(await screen.findByText("Your file is ready.")).toBeTruthy();
  });

  it("a failure is said in plain words and nothing is delivered", async () => {
    const deliver = jest.fn();
    await renderWithProviders(
      <DownloadMyDataRow
        transport={transport(new CommunityError("network", "x"))}
        deliver={deliver}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("data-export-row"));
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(await screen.findByTestId("data-export-error")).toHaveTextContent(
      "No connection. Try again.",
    );
  });
});
