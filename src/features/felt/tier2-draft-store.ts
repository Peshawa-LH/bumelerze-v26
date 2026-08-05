import { create } from "zustand";

import { EMPTY_TIER2_ANSWERS, type Tier2Answers } from "./types";

/**
 * In-memory (NOT persisted) draft for the tier-2 question flow. Each
 * question is its own route (`app/felt-report/step/[step].tsx`), so the
 * in-progress answers need to live somewhere that survives navigating
 * between those screens without surviving an app restart — this is form
 * state, not the durable queued-report state `queue.ts` owns. A restart
 * mid-tier-2 simply loses the in-progress draft; the already-submitted
 * tier-1 pick is unaffected (it was queued the moment tier 1 was tapped).
 */
interface Tier2DraftState {
  feltReportId: string | null;
  eventId: string | null;
  answers: Tier2Answers;
  /** Starts (or resumes) a draft for a given tier-1 report. Re-entering
   * with the SAME `feltReportId` (e.g. the user pressed back mid-flow and
   * came forward again) keeps whatever answers are already collected; a
   * different id always starts a fresh draft. */
  initDraft: (feltReportId: string, eventId: string | null) => void;
  setAnswer: <K extends keyof Tier2Answers>(field: K, value: Tier2Answers[K]) => void;
  reset: () => void;
}

export const useTier2DraftStore = create<Tier2DraftState>((set, get) => ({
  feltReportId: null,
  eventId: null,
  answers: EMPTY_TIER2_ANSWERS,
  initDraft: (feltReportId, eventId) => {
    if (get().feltReportId === feltReportId) {
      return;
    }
    set({ feltReportId, eventId, answers: EMPTY_TIER2_ANSWERS });
  },
  setAnswer: (field, value) =>
    set((state) => ({ answers: { ...state.answers, [field]: value } })),
  reset: () => set({ feltReportId: null, eventId: null, answers: EMPTY_TIER2_ANSWERS }),
}));
