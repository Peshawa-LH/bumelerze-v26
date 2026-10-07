import data from "./data/ims25.generated.json";

/**
 * Typed view of the IMS-25 tables the engine generated
 * (`data/ims25.generated.json`, never edited by hand). Everything the
 * assessment needs sits in this one file's exports so the rest of the feature
 * never touches the raw JSON.
 */

export const VULNERABILITY_CLASSES = ["A", "B", "C", "D", "E", "F"] as const;
export type VulnerabilityClass = (typeof VULNERABILITY_CLASSES)[number];

export type VcProbs = Record<VulnerabilityClass, number>;
/** IMS-25 type id ("M6", "RC1-L", ...) to probability. */
export type ImsTypeProbs = Record<string, number>;

export type DamageGrade = 1 | 2 | 3 | 4 | 5;
export type DamageQuantity = "few" | "many" | "most";
export type IntensityLevel = "VI" | "VII" | "VIII";
export const DAMAGE_INTENSITIES: readonly IntensityLevel[] = ["VI", "VII", "VIII"];

/** The numeric level behind each data key above. The keys stay Roman (they
 * are the published table's own labels); what the reader sees is printed
 * from this number by `formatIntensity`, which picks Roman or digits by
 * language. */
export const INTENSITY_LEVEL_NUMBER: Record<IntensityLevel, number> = {
  VI: 6,
  VII: 7,
  VIII: 8,
};

export type StockRegion = "kurdistan" | "iraq";
export type StockSettlement = "urban" | "rural";
export type StoreyBand = "1" | "2" | "3" | "4-5" | "6+" | "unknown";

export interface ImsType {
  type: string;
  group: string;
  description: string;
  erd: string | null;
  vc_min: VulnerabilityClass;
  vc_most_likely: VulnerabilityClass;
  vc_max: VulnerabilityClass;
  vc_prior: VcProbs;
}

interface Ims25Data {
  types: ImsType[];
  damage_logic: Record<string, Record<string, Record<string, string>>>;
  quantities: Record<DamageQuantity, { min: number; max: number; typical: number }>;
  priors: Record<
    StockRegion,
    Record<StockSettlement, Record<StoreyBand, Record<string, number>>>
  >;
}

const ims25 = data as unknown as Ims25Data;

export const IMS_TYPES: readonly ImsType[] = ims25.types;
export const DAMAGE_LOGIC = ims25.damage_logic;
export const DAMAGE_QUANTITIES = ims25.quantities;
export const TYPE_PRIORS = ims25.priors;

const BY_ID = new Map(IMS_TYPES.map((entry) => [entry.type, entry]));

export function imsType(id: string): ImsType | undefined {
  return BY_ID.get(id);
}
