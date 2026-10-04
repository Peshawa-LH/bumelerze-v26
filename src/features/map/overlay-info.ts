import {
  AFEAD_HIT_LAYER_ID,
  AFEAD_LAYER_ID,
  FAULTS_HIT_LAYER_ID,
  FAULTS_LAYER_ID,
  HISTORICAL_LAYER_ID,
} from "./layer-registry";

/** What a tap on a context layer tells the reader (MapOverlayInfoCard). */
export type FaultSense =
  | "reverse"
  | "thrust"
  | "normal"
  | "dextral"
  | "sinistral"
  | "vertical"
  | "extension"
  | "unknown";

export interface FaultInfo {
  kind: "fault";
  source: "afead" | "gem";
  name: string | null;
  zone: string | null;
  primary: FaultSense;
  secondary: FaultSense | null;
  /** GEM: (preferred, min, max) in mm/yr. */
  slipRate: { preferred: number; min: number | null; max: number | null } | null;
  /** AFEAD rank 1 (> 5 mm/yr), 2 (1–5), 3 (< 1). */
  rateRank: "1" | "2" | "3" | null;
  /** AFEAD activity confidence, A (proven) … D (evidence insufficient). */
  confidence: "A" | "B" | "C" | "D" | null;
  references: string | null;
  /** GEM's contributing model (EMME in this region). */
  catalog: string | null;
}

export interface QuakeInfo {
  kind: "quake";
  id: string;
  year: number;
  timeMs: number | null;
  magnitude: number;
  magType: string;
  depthKm: number | null;
  source: string;
  era: "historical" | "early" | "modern";
}

export type OverlayInfo = FaultInfo | QuakeInfo;

const AFEAD_SENSE: Record<string, FaultSense> = {
  R: "reverse",
  T: "thrust",
  N: "normal",
  D: "dextral",
  S: "sinistral",
  V: "vertical",
  U: "unknown",
  E: "extension",
};

const GEM_SENSE: Record<string, FaultSense> = {
  Reverse: "reverse",
  Normal: "normal",
  Dextral: "dextral",
  Sinistral: "sinistral",
};

type Props = Record<string, unknown> | null | undefined;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** GEM `net_slip_rate` is a "(preferred,min,max)" string in mm/yr. */
export function parseGemSlipRate(value: unknown): FaultInfo["slipRate"] {
  const text = str(value);
  if (!text) return null;
  const parts = text
    .replace(/[()]/g, "")
    .split(",")
    .map((p) => num(p.trim()));
  const preferred = parts[0];
  if (preferred === null || preferred === undefined) return null;
  return { preferred, min: parts[1] ?? null, max: parts[2] ?? null };
}

/** GEM `slip_type`: "Dextral-Reverse" → dextral with a reverse component. */
export function parseGemSlipType(value: unknown): {
  primary: FaultSense;
  secondary: FaultSense | null;
} {
  const [first, second] = (str(value) ?? "").split("-");
  return {
    primary: (first && GEM_SENSE[first]) || "unknown",
    secondary: (second && GEM_SENSE[second]) || null,
  };
}

export function describeOverlayFeature(
  layerId: string,
  properties: Props,
): OverlayInfo | null {
  const p = properties ?? {};
  if (layerId === HISTORICAL_LAYER_ID) {
    const magnitude = num(p.m);
    const year = num(p.year);
    if (magnitude === null || year === null) return null;
    const era = p.era === "historical" || p.era === "early" ? p.era : "modern";
    return {
      kind: "quake",
      id: str(p.id) ?? "",
      year,
      timeMs: num(p.t),
      magnitude,
      magType: str(p.mt) ?? "M",
      depthKm: num(p.d),
      source: str(p.src) ?? "",
      era,
    };
  }
  if (layerId === AFEAD_HIT_LAYER_ID || layerId === AFEAD_LAYER_ID) {
    const rank = str(p.r);
    const conf = str(p.c);
    const s1 = str(p.s1);
    const s2 = str(p.s2);
    return {
      kind: "fault",
      source: "afead",
      name: str(p.n),
      zone: str(p.z),
      primary: (s1 && AFEAD_SENSE[s1]) || "unknown",
      secondary: (s2 && AFEAD_SENSE[s2]) || null,
      slipRate: null,
      rateRank: rank === "1" || rank === "2" || rank === "3" ? rank : null,
      confidence:
        conf === "A" || conf === "B" || conf === "C" || conf === "D" ? conf : null,
      references: str(p.a),
      catalog: null,
    };
  }
  if (layerId === FAULTS_HIT_LAYER_ID || layerId === FAULTS_LAYER_ID) {
    return {
      kind: "fault",
      source: "gem",
      name: str(p.name),
      zone: null,
      ...parseGemSlipType(p.slip_type),
      slipRate: parseGemSlipRate(p.net_slip_rate),
      rateRank: null,
      confidence: null,
      references: null,
      catalog: str(p.catalog_name),
    };
  }
  return null;
}
