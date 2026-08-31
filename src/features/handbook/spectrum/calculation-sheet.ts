import type { TFunction } from "i18next";

import { governingCs } from "./compute";
import { allowableDrift } from "./drift";
import { seismicLoadEffects, SEISMIC_LOAD_COMBINATIONS } from "./load-effects";
import { computePeriod } from "./period";
import { checkHeight, type StructuralSystem } from "./structural-systems";
import type { SpectrumInputs, SpectrumParameters } from "./types";

/**
 * A plain-text calculation sheet: every design parameter for one site, each
 * with the clause it came from.
 *
 * WHY TEXT, AND WHY EVERY LINE CARRIES A CLAUSE
 * ---------------------------------------------
 * The work this saves an engineer is not the arithmetic, which they can do.
 * It is the fifteen lookups across a 205-page Arabic PDF, and then having
 * to justify each one in a calculation report. A block of plain text pastes
 * into Word, an email, a spreadsheet or a submittal unchanged, and a line
 * that names its own clause can be checked by a reviewer without asking
 * where it came from.
 *
 * Deliberately NOT a PDF: a generated PDF looks like a certified document,
 * and this is a preliminary tool. Text that an engineer pastes into their
 * own sheet stays visibly theirs, which is the honest framing.
 *
 * Numerals are ASCII here, not localized: this is a machine-readable
 * artifact destined for a spreadsheet or a report, where Eastern
 * Arabic-Indic digits would be a liability. That is the opposite of the
 * screen rule and is intentional.
 */

export interface CalculationSheetInput {
  lat: number;
  lon: number;
  ss2475: number;
  s12475: number;
  pga2475: number;
  /** Where the mapped values came from: the interpolated point value, plus
   * the nearest published district as the auditable anchor. */
  nearestDistrict: { name: string; distanceKm: number } | null;
  zone: string | null;
  vs30MS: number | null;
  inputs: SpectrumInputs;
  params: SpectrumParameters;
  system: StructuralSystem | null;
  heightM: number | null;
}

function line(label: string, value: string, clause?: string): string {
  return clause ? `${label}: ${value}   [${clause}]` : `${label}: ${value}`;
}

function n(value: number, decimals = 3): string {
  return value.toFixed(decimals);
}

export interface CalculationSheetOptions {
  /**
   * The closing "preliminary reference only" line. On by default, because
   * a sheet pasted into an email carries nothing else that says what it
   * is. The printed report turns it OFF: that page already states the same
   * thing in a boxed callout, and printing the paragraph twice on one A4
   * side wastes the space and reads as an oversight.
   */
  includeFooter?: boolean;
  /**
   * The title rule and the site block (location, nearest district, zone).
   * On by default. The printed report turns it OFF because its own
   * headline and summary grid state all four already, and a page that
   * says the same six facts twice within 40 mm reads as a draft.
   */
  includeSiteHeader?: boolean;
  /**
   * Which edition the mapped values were read off, for the clause tag on
   * each of them. Defaults to 2025, the app's default source. A sheet that
   * tags 2017 band values as "ISC-2025" is a citation to a document that
   * does not contain them, which is the one error a clause reference
   * exists to prevent.
   */
  sourceTag?: string;
}

export function buildCalculationSheet(
  data: CalculationSheetInput,
  t: TFunction,
  options: CalculationSheetOptions = {},
): string {
  const { params, inputs, system } = data;
  const tag = options.sourceTag ?? "ISC-2025";
  const out: string[] = [];

  if (options.includeSiteHeader !== false) {
    out.push(t("handbook.sheet.title"));
    out.push("=".repeat(t("handbook.sheet.title").length));
    out.push("");
    out.push(line(t("handbook.sheet.location"), `${n(data.lat, 4)}, ${n(data.lon, 4)}`));
    if (data.nearestDistrict) {
      out.push(
        line(
          t("handbook.sheet.nearestDistrict"),
          `${data.nearestDistrict.name}, ${n(data.nearestDistrict.distanceKm, 1)} km`,
        ),
      );
    }
    if (data.zone) {
      out.push(line(t("handbook.sheet.zone"), data.zone, `${tag} Ss map`));
    }
    out.push("");
  }

  out.push(t("handbook.sheet.groundMotion", { source: tag }));
  out.push(line("Ss", `${n(data.ss2475, 2)} g`, `${tag}, 2475-yr`));
  out.push(line("S1", `${n(data.s12475, 2)} g`, `${tag}, 2475-yr`));
  out.push(line("PGA", `${n(data.pga2475, 2)} g`, `${tag}, 2475-yr`));
  if (data.vs30MS !== null) {
    out.push(line("Vs30", `${Math.round(data.vs30MS)} m/s`, t("handbook.sheet.vs30Source")));
  }
  out.push(line(t("handbook.sheet.siteClass"), inputs.siteClass, "ISC-2017 T7-1/1"));
  out.push("");

  out.push(t("handbook.sheet.designParameters"));
  out.push(line("Fa", n(params.fa), "ISC-2017 T2-2/1(a)"));
  out.push(line("Fv", n(params.fv), "ISC-2017 T2-2/1(b)"));
  out.push(line("SMS", `${n(params.sms)} g`, "ISC-2017 eq. 2-2/1"));
  out.push(line("SM1", `${n(params.sm1)} g`, "ISC-2017 eq. 2-2/2"));
  out.push(line("SDS", `${n(params.sds)} g`, "ISC-2017 eq. 2-2/3"));
  out.push(line("SD1", `${n(params.sd1)} g`, "ISC-2017 eq. 2-2/4"));
  out.push(line("T0", `${n(params.t0)} s`, "ISC-2017 §2-2/5"));
  out.push(line("Ts", `${n(params.ts)} s`, "ISC-2017 §2-2/5"));
  out.push(line("TL", `${n(params.tl, 1)} s`, "ISC-2017 §2-2/5"));
  out.push(line("I", n(params.importanceFactor, 2), "ISC-2017 T2-3/1"));
  out.push(line(t("handbook.sheet.sdc"), params.seismicDesignCategory, "ISC-2017 T2-4/1, T2-4/2"));
  out.push("");

  if (system) {
    out.push(t("handbook.sheet.system"));
    out.push(line(t("handbook.sheet.systemName"), t(`handbook.spectrum.systems.${system.id}`)));
    out.push(line("R", n(system.r, 2), "ISC-2017 T3-2/1"));
    out.push(line("Omega0", n(system.omega0, 2), "ISC-2017 T3-2/1"));
    out.push(line("Cd", n(system.cd, 2), "ISC-2017 T3-2/1"));

    const check = checkHeight(system, params.seismicDesignCategory, data.heightM);
    const heightText =
      check.status === "notPermitted"
        ? t("handbook.spectrum.heightCheck.notPermitted", { sdc: params.seismicDesignCategory })
        : check.status === "unlimited"
          ? t("handbook.spectrum.heightCheck.unlimited", { sdc: params.seismicDesignCategory })
          : check.status === "overLimit"
            ? t("handbook.spectrum.heightCheck.overLimit", {
                sdc: params.seismicDesignCategory,
                limit: String(check.limitM),
              })
            : t("handbook.spectrum.heightCheck.withinLimit", {
                sdc: params.seismicDesignCategory,
                limit: String(check.limitM),
              });
    out.push(line(t("handbook.sheet.heightLimit"), heightText, "ISC-2017 T3-2/1"));

    if (data.heightM !== null) {
      const period = computePeriod(system, data.heightM, params.sd1);
      const cs = governingCs(params, inputs.r, period.ta);
      out.push(line("hn", `${n(data.heightM, 1)} m`));
      out.push(line("Ta", `${n(period.ta)} s`, `ISC-2017 eq. 3-9/5, T3-9/2 (Ct ${period.ct}, x ${period.x})`));
      out.push(line("Cu", n(period.cu, 2), "ISC-2017 T3-9/1"));
      out.push(line("Cu*Ta", `${n(period.cuTa)} s`, "ISC-2017 §3-9/3/1"));
      out.push(
        line(
          "Cs",
          `${n(cs.cs)}  (${t(`handbook.spectrum.period.governedBy.${cs.governedBy}`)})`,
          "ISC-2017 eq. 3-9/2, 3-9/3, 3-9/4",
        ),
      );
      out.push(line("V", `Cs x W = ${n(cs.cs)} W`, "ISC-2017 eq. 3-9/1"));
    }

    const drift = allowableDrift(system, inputs.occupancy);
    out.push(line(t("handbook.sheet.driftLimit"), `${drift.ratio} x hsx`, "ISC-2017 T3-12/1"));
    out.push("");

    const effects = seismicLoadEffects(params.sds, system.omega0);
    out.push(t("handbook.sheet.loadEffects"));
    if (effects.verticalTermOmitted) {
      out.push(t("handbook.sheet.verticalOmitted"));
      out.push(line("E", "rho x QE", "ISC-2017 eq. 3-4/1, 3-4/14"));
      out.push(line("Em", `${n(system.omega0, 2)} x QE`, "ISC-2017 eq. 3-4/15, 3-4/16"));
    } else {
      out.push(line("Ev = 0.2 SDS D", `${n(effects.verticalCoefficient)} D`, "ISC-2017 §3-4"));
      out.push(line("E", `rho x QE +/- ${n(effects.verticalCoefficient)} D`, "ISC-2017 eq. 3-4/1, 3-4/14"));
      out.push(
        line(
          "Em",
          `${n(system.omega0, 2)} x QE +/- ${n(effects.verticalCoefficient)} D`,
          "ISC-2017 eq. 3-4/15, 3-4/16",
        ),
      );
    }
    out.push(t("handbook.sheet.rhoNote"));
    for (const c of SEISMIC_LOAD_COMBINATIONS) {
      out.push(line(`  ${c.eq}`, c.expression));
    }
    out.push("");
  }

  if (options.includeFooter !== false) {
    out.push(t("handbook.sheet.footer"));
  }
  return out.join("\n");
}
