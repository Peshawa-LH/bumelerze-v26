import { getSupabaseClient, signInAnonymously } from "@/lib/supabase";
import { GUIDELINES_VERSION, type GuidelinesSource } from "./constants";

export type GuidelinesErrorCode = "network" | "unavailable" | "unknown";

export class GuidelinesError extends Error {
  readonly code: GuidelinesErrorCode;
  constructor(code: GuidelinesErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GuidelinesError";
    this.code = code;
  }
}

/** Raised by the gate when the person closes the sheet without agreeing. */
export class GuidelinesDeclinedError extends Error {
  constructor() {
    super("guidelines_declined");
    this.name = "GuidelinesDeclinedError";
  }
}

export interface GuidelinesTransport {
  /** Records "I agree" and "I am 13 or older" for the current identity,
   * guest or account (`accept_guidelines`, migration 0056). */
  accept(source: GuidelinesSource): Promise<void>;
}

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

export function toGuidelinesError(error: unknown): GuidelinesError {
  if (error instanceof GuidelinesError) {
    return error;
  }
  const e: ErrorLike =
    typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const message = e.message ?? "";
  // The function is missing until migration 0056 is applied.
  if (e.code === "PGRST202" || e.code === "42883" || e.status === 404) {
    return new GuidelinesError("unavailable", message);
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    /network|failed to fetch|fetch failed|timed out/i.test(message)
  ) {
    return new GuidelinesError("network", message);
  }
  return new GuidelinesError("unknown", message);
}

export const SupabaseGuidelinesTransport: GuidelinesTransport = {
  async accept(source) {
    const client = getSupabaseClient();
    if (!client) {
      throw new GuidelinesError("unavailable", "Supabase is not configured");
    }
    try {
      await signInAnonymously();
    } catch (error) {
      throw toGuidelinesError(error);
    }
    const { error } = await client.rpc("accept_guidelines", {
      p_version: GUIDELINES_VERSION,
      p_age_ok: true,
      p_source: source,
    });
    if (error) {
      throw toGuidelinesError(error);
    }
  },
};
