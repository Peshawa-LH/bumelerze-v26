import { MAIN_TOWNS, type MainTown } from "@/features/geo/main-towns";

/** Interim aliases; the HomeBase picker is being replaced by the place search. */
export type HomeBaseTown = MainTown;
export const HOME_BASE_TOWNS: readonly HomeBaseTown[] = MAIN_TOWNS;

/** Sentinel id for "elsewhere" — a free skip, never geocoded. */
export const HOME_BASE_ELSEWHERE_ID = "elsewhere";
