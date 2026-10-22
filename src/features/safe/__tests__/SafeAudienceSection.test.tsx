import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { SafeAudienceSection } from "../components/SafeAudienceSection";
import type { SafeAudience, SafeAudienceTransport } from "../transport";

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u1",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

const DATA: SafeAudience = {
  audience: "mutual",
  family: 2,
  mutual: 3,
  followers: 5,
  follows: 3,
};

function fake(
  overrides: Partial<SafeAudienceTransport> = {},
): jest.Mocked<SafeAudienceTransport> {
  return {
    fetchAudience: jest.fn(async () => DATA),
    setAudience: jest.fn(async (audience) => ({
      ...DATA,
      audience,
      follows: audience === "family" ? 0 : audience === "followers" ? 5 : 3,
    })),
    ...overrides,
  } as jest.Mocked<SafeAudienceTransport>;
}

let queryClient = new QueryClient();

async function flush() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderSection(transport: SafeAudienceTransport) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await act(async () => {
    await render(
      <QueryClientProvider client={queryClient}>
        <SafeAudienceSection transport={transport} />
      </QueryClientProvider>,
    );
  });
  await flush();
}

beforeEach(async () => {
  mockAccount = { status: "account", userId: "u1" };
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("Settings > Notifications: who sees my I'm safe (review note 3.3)", () => {
  it("offers the three choices, mutual follows selected by default, and says who that reaches", async () => {
    await renderSection(fake());
    expect(screen.getByText("Who gets my “I'm safe”")).toBeTruthy();
    expect(screen.getByTestId("safe-audience-family")).toHaveTextContent("Family");
    expect(screen.getByTestId("safe-audience-mutual")).toHaveTextContent(
      "Family + mutual follows",
    );
    expect(screen.getByTestId("safe-audience-followers")).toHaveTextContent(
      "Family + all followers",
    );
    expect(
      screen.getByTestId("safe-audience-mutual").props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.getByTestId("safe-audience-reach")).toHaveTextContent(
      "Your family and 3 of your mutual follows will see this.",
    );
    expect(screen.getByText(/Never your location/)).toBeTruthy();
  });

  it("saves a new choice on the server and shows what it reaches", async () => {
    const transport = fake();
    await renderSection(transport);
    await act(async () => {
      fireEvent.press(screen.getByTestId("safe-audience-followers"));
    });
    await flush();
    expect(transport.setAudience).toHaveBeenCalledWith("followers");
    expect(
      screen.getByTestId("safe-audience-followers").props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.getByTestId("safe-audience-reach")).toHaveTextContent(
      "Your family and 5 of your followers will see this.",
    );
  });

  it("says so when saving fails, and keeps the old choice", async () => {
    const transport = fake({
      setAudience: jest.fn(async () => Promise.reject(new Error("x"))),
    });
    await renderSection(transport);
    await act(async () => {
      fireEvent.press(screen.getByTestId("safe-audience-family"));
    });
    await flush();
    expect(screen.getByTestId("safe-audience-error")).toHaveTextContent(
      "Couldn't save. Please try again.",
    );
    expect(
      screen.getByTestId("safe-audience-mutual").props.accessibilityState.checked,
    ).toBe(true);
  });

  it("explains when none of the family or friends would see it", async () => {
    await renderSection(
      fake({
        fetchAudience: jest.fn(async () => ({
          ...DATA,
          family: 0,
          mutual: 0,
          follows: 0,
        })),
      }),
    );
    expect(screen.getByTestId("safe-audience-reach")).toHaveTextContent(
      /Right now none of your family or friends would see it/,
    );
  });

  it("is not shown when the setting cannot be loaded (before the migration, offline)", async () => {
    await renderSection(
      fake({ fetchAudience: jest.fn(async () => Promise.reject(new Error("x"))) }),
    );
    expect(screen.queryByTestId("safe-audience")).toBeNull();
  });

  it("is not shown to guests, and asks the server nothing", async () => {
    mockAccount = { status: "anonymous", userId: "g" };
    const transport = fake();
    await renderSection(transport);
    expect(screen.queryByTestId("safe-audience")).toBeNull();
    expect(transport.fetchAudience).not.toHaveBeenCalled();
  });

  it("reads right to left in Sorani with Sorani digits", async () => {
    await i18n.changeLanguage("ckb");
    await renderSection(fake());
    expect(await screen.findByTestId("safe-audience-reach")).toHaveTextContent(/٣/);
  });
});
