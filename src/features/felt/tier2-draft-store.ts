import { create } from "zustand";

import { EMPTY_TIER2_ANSWERS, type Tier2Answers } from "./types";

/**
 * In-memory (NOT persisted) draft for the post-tier-1 flow: windows 2/3
 * (damage, comment/photo) and the optional "add more detail" questionnaire
 * all read/write this SAME draft (2026-08-15 flow restructure, owner
 * directive) — each screen is its own route
 * (`app/felt-report/damage.tsx`, `details.tsx`, `step/[step].tsx`), so the
 * in-progress answers need to live somewhere that survives navigating
 * between those screens without surviving an app restart — this is form
 * state, not the durable queued-report state `queue.ts` owns. A restart
 * mid-flow simply loses the in-progress draft; the already-submitted tier-1
 * pick is unaffected (it was queued the moment tier 1 was tapped, window 1).
 */
interface Tier2DraftState {
  feltReportId: string | null;
  eventId: string | null;
  answers: Tier2Answers;
  /** Window 3's optional photo attachment — see `Tier2Report.photoUri`'s
   * own doc for why this lives outside `answers`. */
  photoUri: string | null;
  /** Starts (or resumes) a draft for a given tier-1 report. Re-entering
   * with the SAME `feltReportId` (e.g. the user pressed back mid-flow and
   * came forward again) keeps whatever answers are already collected; a
   * different id always starts a fresh draft. */
  initDraft: (feltReportId: string, eventId: string | null) => void;
  setAnswer: <K extends keyof Tier2Answers>(field: K, value: Tier2Answers[K]) => void;
  setPhotoUri: (photoUri: string | null) => void;
  reset: () => void;
}

export const useTier2DraftStore = create<Tier2DraftState>((set, get) => ({
  feltReportId: null,
  eventId: null,
  answers: EMPTY_TIER2_ANSWERS,
  photoUri: null,
  initDraft: (feltReportId, eventId) => {
    if (get().feltReportId === feltReportId) {
      return;
    }
    set({ feltReportId, eventId, answers: EMPTY_TIER2_ANSWERS, photoUri: null });
  },
  setAnswer: (field, value) =>
    set((state) => ({ answers: { ...state.answers, [field]: value } })),
  setPhotoUri: (photoUri) => set({ photoUri }),
  reset: () =>
    set({
      feltReportId: null,
      eventId: null,
      answers: EMPTY_TIER2_ANSWERS,
      photoUri: null,
    }),
}));
