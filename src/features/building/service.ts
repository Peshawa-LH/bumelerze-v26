import { assessBuilding, type Assessment } from "./assessment";
import {
  QUESTIONNAIRE_VERSION,
  pruneAnswers,
  sanitizeAnswers,
  type Answers,
} from "./questionnaire";
import { photoContentType, readHomePhoto } from "./photos";
import { SupabaseHomeTransport, type HomeTransport } from "./transport";
import type { HomeKind, LocationQuality } from "./types";

/** What the tag flow collects before anything is sent. */
export interface TagDraft {
  kind: HomeKind;
  /** Optional name for the home ("Mum's house"). */
  label: string;
  /** Apartments only: which flat. */
  unitLabel: string;
  lat: number;
  lon: number;
  /** "gps" device fix, "pin" placed on the map, "town" centre standing in. */
  locationQuality: LocationQuality;
  answers: Answers;
  /** Picked photo uris (front, side, inside; any may be absent). */
  photos: string[];
}

export interface SaveOutcome {
  tagId: string;
  assessment: Assessment;
  photosFailed: number;
}

/** The survey row's `answers` jsonb: the answers plus how exact the point was. */
export function surveyPayload(
  answers: Answers,
  locationQuality?: LocationQuality,
): Record<string, unknown> {
  return {
    ...pruneAnswers(answers),
    ...(locationQuality ? { location_quality: locationQuality } : {}),
  };
}

/** Stored answers back into `Answers` (unknown ids or options are dropped). */
export function answersFromSurvey(raw: unknown): Answers {
  return sanitizeAnswers(raw);
}

/**
 * Saves one survey and its automatic assessment for a tag. The assessment is
 * computed here, in the app, from the answers and the tag's exact point, and
 * stored next to the survey it came from.
 */
export async function saveSurveyAndAssessment(
  tagId: string,
  point: { lat: number; lon: number },
  answers: Answers,
  options: { transport?: HomeTransport; locationQuality?: LocationQuality } = {},
): Promise<Assessment> {
  const transport = options.transport ?? SupabaseHomeTransport;
  const clean = pruneAnswers(answers);
  const assessment = assessBuilding(clean, point.lat, point.lon);
  const surveyId = await transport.saveSurvey({
    tagId,
    version: QUESTIONNAIRE_VERSION,
    answers: surveyPayload(clean, options.locationQuality),
  });
  await transport.saveAssessment({ tagId, surveyId, assessment });
  return assessment;
}

/** Uploads the picked photos; one failing photo never fails the home. */
export async function uploadPhotos(
  tagId: string,
  uris: readonly string[],
  transport: HomeTransport = SupabaseHomeTransport,
): Promise<number> {
  const stamp = Date.now();
  let failed = 0;
  for (const [index, uri] of uris.entries()) {
    try {
      const body = await readHomePhoto(uri);
      await transport.uploadPhoto({
        tagId,
        fileName: `${stamp + index}.jpg`,
        body,
        contentType: photoContentType(uri),
      });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

/**
 * The whole "Tag my building" save: create the tag (unless a previous
 * attempt already did), then survey, assessment and photos. `onTagCreated`
 * fires as soon as the tag exists so a retry after a later failure resumes
 * with `existingTagId` instead of creating a second home.
 */
export async function createHomeFromDraft(
  draft: TagDraft,
  options: {
    transport?: HomeTransport;
    existingTagId?: string | null;
    onTagCreated?: (tagId: string) => void;
  } = {},
): Promise<SaveOutcome> {
  const transport = options.transport ?? SupabaseHomeTransport;
  let tagId = options.existingTagId ?? null;
  if (!tagId) {
    const created = await transport.createTag({
      kind: draft.kind,
      lat: draft.lat,
      lon: draft.lon,
      label: draft.label.trim() ? draft.label.trim() : null,
      unitLabel:
        draft.kind === "apartment" && draft.unitLabel.trim()
          ? draft.unitLabel.trim()
          : null,
    });
    tagId = created.tagId;
    options.onTagCreated?.(tagId);
  }
  const assessment = await saveSurveyAndAssessment(
    tagId,
    { lat: draft.lat, lon: draft.lon },
    draft.answers,
    { transport, locationQuality: draft.locationQuality },
  );
  const photosFailed = await uploadPhotos(tagId, draft.photos, transport);
  return { tagId, assessment, photosFailed };
}
