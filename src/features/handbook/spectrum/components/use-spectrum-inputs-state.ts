import { useState } from "react";

import {
  BUILDING_HEIGHT_BOUND,
  DEFAULT_STRUCTURAL_SYSTEM_ID,
  R_INPUT_BOUND,
  S1_INPUT_BOUND,
  SS_INPUT_BOUND,
} from "../config";
import { findStructuralSystem, type StructuralSystem } from "../structural-systems";
import type {
  IscSiteClass,
  OccupancyCategory,
  SpectrumCodeValues,
  SpectrumInputs,
} from "../types";
import { type NumberFieldError, validatePositiveNumberField } from "../validation";

export interface SpectrumInputsState {
  /** The code values this form started from, `null` when the coordinate is
   * outside ISC-2025 coverage and the engineer must supply both. */
  codeValues: SpectrumCodeValues | null;
  /** True once either field no longer matches what the code offered, so
   * the UI can stop attributing the numbers to the code. */
  isOverriddenFromCode: boolean;
  resetToCodeValues: () => void;

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

  /** The chosen seismic-force-resisting system, or `null` when the engineer
   * picked "other" and is entering `R` by hand. */
  system: StructuralSystem | null;
  systemId: string | null;
  setSystemId: (id: string | null) => void;

  /** Building height above the base, metres. `null` until entered; the
   * height limit still displays without it, only the pass/fail waits. */
  heightText: string;
  heightError: NumberFieldError | null;
  heightM: number | null;
  setHeightText: (text: string) => void;

  /** Free entry, used ONLY when `system` is null. With a system chosen,
   * `R` comes from the code table and must not be editable. */
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
 * the coordinate and overridable").
 *
 * `codeValues` pre-fills `Ss`/`S1` from the ISC-2025 lookup on the same
 * "derived but overridable" footing. Both are seeded ONCE per mount rather
 * than synchronised by effect, because the screen remounts this section per
 * coordinate (`HandbookScreen` keys it on the looked-up point) — a new site
 * is a new problem, and carrying one city's `Ss` into another city's
 * spectrum is the one failure this form must not have.
 */
export function useSpectrumInputsState(
  derivedSiteClass: IscSiteClass,
  codeValues: SpectrumCodeValues | null = null,
): SpectrumInputsState {
  // Two decimals, unlocalized: this is a parse buffer, not display text.
  // The value the engineer READS is formatted by `format.ts` like every
  // other numeral in the app.
  const codeSsText = codeValues ? codeValues.ss.toFixed(2) : "";
  const codeS1Text = codeValues ? codeValues.s1.toFixed(2) : "";
  const [ssText, setSsText] = useState(codeSsText);
  const [s1Text, setS1Text] = useState(codeS1Text);
  const [siteClass, setSiteClassState] = useState<IscSiteClass>(derivedSiteClass);
  const [isSiteClassOverridden, setIsSiteClassOverridden] = useState(false);
  const [occupancy, setOccupancy] = useState<OccupancyCategory>("I_II");
  const [systemId, setSystemId] = useState<string | null>(DEFAULT_STRUCTURAL_SYSTEM_ID);
  const [heightText, setHeightText] = useState("");
  const system = systemId === null ? null : findStructuralSystem(systemId);
  // Seeded from the default system so "other" starts at a familiar number
  // rather than blank; only ever read when no system is chosen.
  const [rText, setRText] = useState(String(system?.r ?? 4));

  const ssValidation = validatePositiveNumberField(ssText, SS_INPUT_BOUND);
  const s1Validation = validatePositiveNumberField(s1Text, S1_INPUT_BOUND);
  const rValidation = validatePositiveNumberField(rText, R_INPUT_BOUND);
  const heightValidation = validatePositiveNumberField(heightText, BUILDING_HEIGHT_BOUND);
  // Height is optional: blank is a legitimate state, not an error.
  const heightError = heightValidation.error === "empty" ? null : heightValidation.error;

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

  function resetToCodeValues() {
    setSsText(codeSsText);
    setS1Text(codeS1Text);
  }

  const isOverriddenFromCode =
    codeValues !== null && (ssText !== codeSsText || s1Text !== codeS1Text);

  // With a system chosen, `R` is the code's, not the field's — so the form
  // stays usable even if the (hidden) free-entry buffer is mid-edit.
  const effectiveR = system ? system.r : rValidation.value;

  const inputs: SpectrumInputs | null =
    ssValidation.value !== null && s1Validation.value !== null && effectiveR !== null
      ? { ss: ssValidation.value, s1: s1Validation.value, siteClass, occupancy, r: effectiveR }
      : null;

  return {
    codeValues,
    isOverriddenFromCode,
    resetToCodeValues,
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
    system,
    systemId,
    setSystemId,
    heightText,
    heightError,
    heightM: heightValidation.value,
    setHeightText,
    rText,
    rError: rValidation.error,
    setRText,
    inputs,
  };
}
