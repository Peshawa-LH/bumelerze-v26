import { useCallback, useRef, useState, type ReactNode } from "react";

import { GuidelinesSheet } from "./components/GuidelinesSheet";
import {
  GuidelinesDeclinedError,
  SupabaseGuidelinesTransport,
  type GuidelinesTransport,
} from "./transport";

/** True for the refusal of the comment and post insert (migration 0056). */
export function isGuidelinesRequired(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "guidelines_required"
  );
}

export function isGuidelinesDeclined(error: unknown): boolean {
  return error instanceof GuidelinesDeclinedError;
}

interface Waiting {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Wraps a submit: when the server answers `guidelines_required`, shows the
 * guidelines sheet, stores the agreement, and sends the same thing again. The
 * person who closes the sheet gets a `GuidelinesDeclinedError` (callers keep
 * the text and stay quiet). Render `sheet` anywhere in the screen.
 */
export function useGuidelinesGate(
  transport: GuidelinesTransport = SupabaseGuidelinesTransport,
): { guard: <T>(submit: () => Promise<T>) => Promise<T>; sheet: ReactNode } {
  const [open, setOpen] = useState(false);
  const waiting = useRef<Waiting | null>(null);

  const finish = useCallback((error?: Error) => {
    const current = waiting.current;
    waiting.current = null;
    setOpen(false);
    if (current) {
      if (error) {
        current.reject(error);
      } else {
        current.resolve();
      }
    }
  }, []);

  const guard = useCallback(async <T,>(submit: () => Promise<T>): Promise<T> => {
    try {
      return await submit();
    } catch (error) {
      if (!isGuidelinesRequired(error)) {
        throw error;
      }
    }
    await new Promise<void>((resolve, reject) => {
      waiting.current = { resolve, reject };
      setOpen(true);
    });
    return submit();
  }, []);

  const sheet = open ? (
    <GuidelinesSheet
      mode="accept"
      transport={transport}
      onAccepted={() => finish()}
      onClose={() => finish(new GuidelinesDeclinedError())}
    />
  ) : null;

  return { guard, sheet };
}
