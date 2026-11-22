import {
  clearHomePhotoQueue,
  countQueuedHomePhotos,
  isHomePhotoQueueSending,
  processHomePhotoQueue,
} from "@/features/building/photo-queue";
import {
  clearFeedbackQueue,
  countUnsentFeedback,
  isFeedbackQueueSending,
  makeWaitingFeedbackDueNow,
  processFeedbackQueue,
} from "@/features/feedback/queue";
import { resetDeviceId } from "@/features/felt/device-id";
import {
  clearFeltQueue,
  countUnsentReports,
  isFeltQueueSending,
  makeWaitingReportsDueNow,
  processQueue,
} from "@/features/felt/queue";
import { useTier2DraftStore } from "@/features/felt/tier2-draft-store";
import { useArrivedLinkStore, usePendingLinkStore } from "@/features/links/pending-link";
import {
  clearCheckIns,
  countUnsentCheckIns,
  isCheckInQueueSending,
  makeWaitingCheckInsDueNow,
  processCheckInQueue,
} from "@/features/safe/queue";
import { releaseAllDurablePhotos } from "@/lib/durable-photo-uri";
import { clearPersonalQueries } from "@/lib/session-query-cache";

import { discardHandover } from "./handover";

/**
 * What a sign-out does with the things on this device (security audit
 * APP-04). The previous person's data must not stay on a shared phone, and
 * nothing of theirs may be sent later under the next identity.
 *
 * Cleared (per person): the felt-report, feedback, "I'm safe" and home-photo
 * queues, sent items included ("My reports"), and the photo files they keep;
 * every React Query answer that is not public, in memory and on the device
 * (public ones such as the earthquake feed stay, so the app still opens
 * offline: src/lib/session-query-cache.ts); a link kept from before
 * onboarding; the felt details draft; a handover token; the device id (a new
 * one is made).
 *
 * Kept (this device's settings, not a person's): language, appearance,
 * onboarding done, "My location" and alert settings (`bumelerze.prefs`, a
 * town, not a position), map settings, this device's alert registration
 * (`bumelerze-alert-device`; on iOS/Android phone-sync.ts moves it to the
 * next identity or releases it), the daily "last seen" stamp, and restart
 * bookkeeping.
 */

/** How long a sign-out waits for waiting items to go first. */
export const SIGN_OUT_SEND_TIMEOUT_MS = 8_000;
const POLL_MS = 200;

/** Reports, messages, check-ins and home photos the server does not have
 * yet (they would be deleted by a sign-out). */
export function countUnsentItems(): number {
  return (
    countUnsentReports() +
    countUnsentFeedback() +
    countUnsentCheckIns() +
    countQueuedHomePhotos()
  );
}

function anyQueueSending(): boolean {
  return (
    isFeltQueueSending() ||
    isFeedbackQueueSending() ||
    isCheckInQueueSending() ||
    isHomePhotoQueueSending()
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Resolves when `work` settles or `ms` have passed, whichever is first,
 * and leaves no timer behind. */
function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Before a sign-out, while the person is still signed in: tries once to send
 * everything that waits (retry delays skipped), for at most `timeoutMs`.
 * Resolves with how many items are still not on the server. Never throws.
 */
export async function sendWaitingItems(
  timeoutMs: number = SIGN_OUT_SEND_TIMEOUT_MS,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  try {
    makeWaitingReportsDueNow();
    makeWaitingFeedbackDueNow();
    makeWaitingCheckInsDueNow();
    if (countUnsentItems() === 0) {
      return 0;
    }
    const sending = Promise.allSettled([
      processQueue(),
      processFeedbackQueue(),
      processCheckInQueue(),
      processHomePhotoQueue({ ignoreBackoff: true }),
    ]);
    await settledWithin(sending, deadline - Date.now());
    // A pass that was already running when asked returns at once and goes
    // round again by itself: wait for it too, within the same time.
    while (anyQueueSending() && countUnsentItems() > 0 && Date.now() < deadline) {
      await wait(Math.min(POLL_MS, deadline - Date.now()));
    }
  } catch {
    // Counted below: whatever did not go is still waiting.
  }
  return countUnsentItems();
}

/** One step of the clean-up; a failure never stops the others. */
async function attempt(step: () => unknown): Promise<void> {
  try {
    await step();
  } catch {
    // Best effort, step by step (see the module comment).
  }
}

/**
 * Removes the previous person's data from this device. Called by the
 * account service after the server sign-out and BEFORE the new anonymous
 * sign-in. Never throws.
 */
export async function clearPersonalDataOnDevice(): Promise<void> {
  await attempt(discardHandover);
  await attempt(clearFeltQueue);
  await attempt(clearFeedbackQueue);
  await attempt(clearCheckIns);
  await attempt(clearHomePhotoQueue);
  await attempt(() => useTier2DraftStore.getState().reset());
  await attempt(releaseAllDurablePhotos);
  await attempt(() => {
    usePendingLinkStore.getState().clear();
    useArrivedLinkStore.getState().setArrived(null);
  });
  await attempt(() => clearPersonalQueries());
  await attempt(resetDeviceId);
}
