import { useState } from "react";

import { R_INPUT_BOUND, S1_INPUT_BOUND, SS_INPUT_BOUND, VERIFIED_R_VALUES } from "../config";
import type { IscSiteClass, OccupancyCategory, SpectrumInputs } from "../types";
import { type NumberFieldError, validatePositiveNumberField } from "../validation";

export interface SpectrumInputsState {
  ssText: string;
  ssError: NumberFieldError | null;
  setSsText: (text: string) => void;

  s1Text: string;
  s1Error: NumberFieldError | null;
  setS1Text: (text: string) => void;

  siteClass: IscSiteClass;
  isSiteClassOverridden: boolean;
  setSiteClass: (siteClass: IscSiteClass) => void;
  resetSiteClassToDerived: () => void;

  occupancy: OccupancyCategory;
  setOccupancy: (occupancy: OccupancyCategory) => void;

  rText: string;
  rError: NumberFieldError | null;
  setRText: (text: string) => void;

  /** `null` until both `Ss` and `S1` are valid numbers — the chart/table
   * section stays hidden until then (matches the coordinate-lookup pattern
   * one level up: no results until valid input exists). */
  inputs: SpectrumInputs | null;
}

/**
 * Owns every text-field buffer + validation state for the spectrum inputs
 * form, and assembles the validated `SpectrumInputs` the compute layer
 * needs — pulled out of the form component so it is testable with
 * `@testing-library/react-hooks`-style `renderHook` without mounting any
 * `react-native-svg`/RN primitives (same "logic in a hook, RN in the
 * component" split the rest of this app uses for anything with more than
 * one piece of derived state, e.g. `features/location`'s
 * `useUserDistanceAnchor`).
 *
 * `derivedSiteClass` is the ISC-2017 class computed from the coordinate's
 * Vs30 sample (`iscSiteClassFromVs30`, §7.4: "site class pre-filled from
 * the coordinate and overridable"). Passing a NEW `derivedSiteClass` (a new
 * coordinate was looked up) only resets the site class when the engineer
 * has not already overridden it — an explicit override must never be
 * silently clobbered by a re-lookup.
 */
export function useSpectrumInputsState(derivedSiteClass: IscSiteClass): SpectrumInputsState {
  const [ssText, setSsText] = useState("");
  const [s1Text, setS1Text] = useState("");
  const [siteClass, setSiteClassState] = useState<IscSiteClass>(derivedSiteClass);
  const [isSiteClassOverridden, setIsSiteClassOverridden] = useState(false);
  const [occupancy, setOccupancy] = useState<OccupancyCategory>("I_II");
  const [rText, setRText] = useState(String(VERIFIED_R_VALUES[0]?.r ?? 4));

  const ssValidation = validatePositiveNumberField(ssText, SS_INPUT_BOUND);
  const s1Validation = validatePositiveNumberField(s1Text, S1_INPUT_BOUND);
  const rValidation = validatePositiveNumberField(rText, R_INPUT_BOUND);

  // "empty" is the natural first-paint state for Ss/S1 (no submit button on
  // this live calculator, unlike CoordinateInputForm) — surfacing it as a
  // red error before the engineer has typed anything would be alarming for
  // no reason. Any OTHER error (not-a-number, out-of-range) is real
  // feedback on what they typed and still surfaces immediately.
  const ssError = ssValidation.error === "empty" ? null : ssValidation.error;
  const s1Error = s1Validation.error === "empty" ? null : s1Validation.error;

  function setSiteClass(next: IscSiteClass) {
    setSiteClassState(next);
    setIsSiteClassOverridden(next !== derivedSiteClass);
  }

  function resetSiteClassToDerived() {
    setSiteClassState(derivedSiteClass);
    setIsSiteClassOverridden(false);
  }

  const inputs: SpectrumInputs | null =
    ssValidation.value !== null && s1Validation.value !== null && rValidation.value !== null
      ? { ss: ssValidation.value, s1: s1Validation.value, siteClass, occupancy, r: rValidation.value }
      : null;

  return {
    ssText,
    ssError,
    setSsText,
    s1Text,
    s1Error,
    setS1Text,
    siteClass,
    isSiteClassOverridden,
    setSiteClass,
    resetSiteClassToDerived,
    occupancy,
    setOccupancy,
    rText,
    rError: rValidation.error,
    setRText,
    inputs,
  };
}
