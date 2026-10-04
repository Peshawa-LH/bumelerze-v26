import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase";
import type { Assessment, Hazard } from "./assessment";
import { HOME_PHOTOS_BUCKET } from "./constants";
import { VULNERABILITY_CLASSES } from "./ims25";
import {
  HomeError,
  type CreatedHome,
  type HomeKind,
  type HomeMember,
  type HomeTag,
  type JoinResult,
  type StoredAssessment,
  type StoredSurvey,
} from "./types";

/**
 * Tag-my-building data access (migration 0037). Screens and hooks never call
 * Supabase directly; they go through this seam, and tests inject a fake
 * `HomeTransport` or mock `@/lib/supabase` for the real one.
 *
 * Everything here needs a signed-in ACCOUNT: the database refuses anonymous
 * users (error 42501) and RLS shows rows to approved members only.
 */
export interface HomeTransport {
  createTag(input: {
    kind: HomeKind;
    lat: number;
    lon: number;
    label: string | null;
    unitLabel: string | null;
  }): Promise<CreatedHome>;
  requestJoin(code: string, key: string): Promise<JoinResult>;
  decideJoin(tagId: string, userId: string, approve: boolean): Promise<void>;
  leave(tagId: string): Promise<void>;
  rotateKey(tagId: string): Promise<string>;
  fetchMemberships(userId: string): Promise<HomeMember[]>;
  fetchTags(tagIds: readonly string[]): Promise<HomeTag[]>;
  /** Owner only; null for anyone else. */
  fetchJoinKey(tagId: string): Promise<string | null>;
  fetchMembers(tagId: string): Promise<HomeMember[]>;
  fetchDisplayNames(userIds: readonly string[]): Promise<Record<string, string>>;
  fetchLatestAssessments(
    tagIds: readonly string[],
  ): Promise<Record<string, StoredAssessment>>;
  fetchLatestSurvey(tagId: string): Promise<StoredSurvey | null>;
  saveSurvey(input: {
    tagId: string;
    version: string;
    answers: Record<string, unknown>;
  }): Promise<string>;
  saveAssessment(input: {
    tagId: string;
    surveyId: string;
    assessment: Assessment;
  }): Promise<void>;
  uploadPhoto(input: {
    tagId: string;
    fileName: string;
    body: Blob | ArrayBuffer;
    contentType: string;
  }): Promise<void>;
  /** Short-lived signed links to the home's photos. */
  fetchPhotoUrls(tagId: string): Promise<string[]>;
}

export type HomeErrorContext = "create" | "join" | "other";

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

/** Maps a PostgREST / RPC / fetch failure to a `HomeError` the UI can word.
 * 42501 = needs an account (or owners only), 54000 = a limit (5 homes, or too
 * many join tries, told apart by `context`), 22023 = wrong code or key. */
export function toHomeError(
  error: unknown,
  context: HomeErrorContext = "other",
): HomeError {
  if (error instanceof HomeError) {
    return error;
  }
  const e: ErrorLike =
    typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const message = e.message ?? "";
  if (e.code === "42501") {
    return new HomeError("need_account", message);
  }
  if (e.code === "54000" || e.status === 429) {
    return new HomeError(context === "join" ? "join_limit" : "homes_limit", message);
  }
  if (e.code === "22023") {
    return new HomeError("wrong_code", message);
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    /network|failed to fetch|fetch failed|timed out/i.test(message)
  ) {
    return new HomeError("network", message);
  }
  return new HomeError("unknown", message);
}

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new HomeError("unconfigured");
  }
  return client;
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous === true) {
    throw new HomeError("need_account");
  }
  return user.id;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
const ID_CHUNK = 60;

// ---------------------------------------------------------------------------
// Row parsing. Rows that fail the contract are dropped, never thrown on.
// ---------------------------------------------------------------------------

const tagRowSchema = z.object({
  tag_id: z.string(),
  code: z.string(),
  owner_user_id: z.string().nullable(),
  kind: z.enum(["house", "apartment"]),
  label: z.string().nullable(),
  unit_label: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  complex_id: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  created_at: z.string(),
});

export const TAG_COLUMNS =
  "tag_id, code, owner_user_id, kind, label, unit_label, lat, lon, complex_id, status, created_at";

export function parseTagRows(rows: unknown): HomeTag[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const tags: HomeTag[] = [];
  for (const row of rows) {
    const parsed = tagRowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const r = parsed.data;
    tags.push({
      tagId: r.tag_id,
      code: r.code,
      ownerUserId: r.owner_user_id,
      kind: r.kind,
      label: r.label,
      unitLabel: r.unit_label,
      lat: r.lat,
      lon: r.lon,
      complexId: r.complex_id,
      status: r.status,
      createdAt: r.created_at,
    });
  }
  return tags;
}

const memberRowSchema = z.object({
  tag_id: z.string(),
  user_id: z.string(),
  role: z.enum(["owner", "member"]),
  status: z.enum(["pending", "approved"]),
  requested_at: z.string(),
});

export const MEMBER_COLUMNS = "tag_id, user_id, role, status, requested_at";

export function parseMemberRows(rows: unknown): HomeMember[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const members: HomeMember[] = [];
  for (const row of rows) {
    const parsed = memberRowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const r = parsed.data;
    members.push({
      tagId: r.tag_id,
      userId: r.user_id,
      role: r.role,
      status: r.status,
      requestedAt: r.requested_at,
    });
  }
  return members;
}

const classEnum = z.enum(VULNERABILITY_CLASSES);

const hazardSchema = z.object({
  pga_g: z.number().nullable().optional(),
  zone: z.string().nullable().optional(),
  vs30: z.number().nullable().optional(),
  site_class: z.string().nullable().optional(),
  source: z.string().optional(),
});

const assessmentRowSchema = z.object({
  assessment_id: z.string(),
  tag_id: z.string(),
  survey_id: z.string().nullable(),
  method: z.string(),
  ims_type_probs: z.record(z.coerce.number()),
  vc_probs: z.record(z.coerce.number()),
  vc_most_likely: classEnum,
  vc_range: z.string().nullable(),
  // numeric columns arrive as numbers or strings depending on the driver
  confidence: z.coerce.number().nullable(),
  hazard: hazardSchema.nullable(),
  review_status: z.enum(["automatic", "engineer_reviewed"]),
  created_at: z.string(),
});

export const ASSESSMENT_COLUMNS =
  "assessment_id, tag_id, survey_id, method, ims_type_probs, vc_probs, vc_most_likely, vc_range, confidence, hazard, review_status, created_at";

export function parseAssessmentRows(rows: unknown): StoredAssessment[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const result: StoredAssessment[] = [];
  for (const row of rows) {
    const parsed = assessmentRowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const r = parsed.data;
    const vcProbs = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    for (const vc of VULNERABILITY_CLASSES) {
      vcProbs[vc] = r.vc_probs[vc] ?? 0;
    }
    const hazard: Hazard | null = r.hazard
      ? {
          pga_g: r.hazard.pga_g ?? null,
          zone: r.hazard.zone ?? null,
          vs30: r.hazard.vs30 ?? null,
          site_class: r.hazard.site_class ?? null,
          source: r.hazard.source ?? "ISC-2025",
        }
      : null;
    result.push({
      assessmentId: r.assessment_id,
      tagId: r.tag_id,
      surveyId: r.survey_id,
      method: r.method,
      imsTypeProbs: r.ims_type_probs,
      vcProbs,
      vcMostLikely: r.vc_most_likely,
      vcRange: r.vc_range,
      confidence: r.confidence,
      hazard,
      reviewStatus: r.review_status,
      createdAt: r.created_at,
    });
  }
  return result;
}

const surveyRowSchema = z.object({
  survey_id: z.string(),
  tag_id: z.string(),
  version: z.string(),
  answers: z.unknown(),
  created_at: z.string(),
});

const createdSchema = z.object({
  tag_id: z.string(),
  code: z.string(),
  join_key: z.string(),
});

const joinSchema = z.object({
  tag_id: z.string(),
  status: z.enum(["pending", "approved"]),
});

interface ProfileRow {
  user_id: string;
  display_name: string;
}

export const SupabaseHomeTransport: HomeTransport = {
  async createTag({ kind, lat, lon, label, unitLabel }) {
    const client = requireClient();
    const { data, error } = await client.rpc("create_home_tag", {
      p_kind: kind,
      p_lat: lat,
      p_lon: lon,
      p_label: label,
      p_unit_label: unitLabel,
    });
    if (error) {
      throw toHomeError(error, "create");
    }
    const parsed = createdSchema.safeParse(data);
    if (!parsed.success) {
      throw new HomeError("unknown", "create_home_tag: unexpected result");
    }
    return {
      tagId: parsed.data.tag_id,
      code: parsed.data.code,
      joinKey: parsed.data.join_key,
    };
  },

  async requestJoin(code, key) {
    const client = requireClient();
    const { data, error } = await client.rpc("request_join_home", {
      p_code: code,
      p_key: key,
    });
    if (error) {
      throw toHomeError(error, "join");
    }
    const parsed = joinSchema.safeParse(data);
    if (!parsed.success) {
      throw new HomeError("unknown", "request_join_home: unexpected result");
    }
    return { tagId: parsed.data.tag_id, status: parsed.data.status };
  },

  async decideJoin(tagId, userId, approve) {
    const client = requireClient();
    const { error } = await client.rpc("decide_join_request", {
      p_tag: tagId,
      p_user: userId,
      p_approve: approve,
    });
    if (error) {
      throw toHomeError(error);
    }
  },

  async leave(tagId) {
    const client = requireClient();
    const { error } = await client.rpc("leave_home", { p_tag: tagId });
    if (error) {
      throw toHomeError(error);
    }
  },

  async rotateKey(tagId) {
    const client = requireClient();
    const { data, error } = await client.rpc("rotate_join_key", { p_tag: tagId });
    if (error) {
      throw toHomeError(error);
    }
    if (typeof data !== "string") {
      throw new HomeError("unknown", "rotate_join_key: unexpected result");
    }
    return data;
  },

  async fetchMemberships(userId) {
    const client = requireClient();
    const { data, error } = await client
      .from("home_members")
      .select(MEMBER_COLUMNS)
      .eq("user_id", userId);
    if (error) {
      throw toHomeError(error);
    }
    return parseMemberRows(data);
  },

  async fetchTags(tagIds) {
    if (tagIds.length === 0) {
      return [];
    }
    const client = requireClient();
    const tags: HomeTag[] = [];
    for (const ids of chunk(tagIds, ID_CHUNK)) {
      const { data, error } = await client
        .from("home_tags")
        .select(TAG_COLUMNS)
        .in("tag_id", ids);
      if (error) {
        throw toHomeError(error);
      }
      tags.push(...parseTagRows(data));
    }
    return tags;
  },

  async fetchJoinKey(tagId) {
    const client = requireClient();
    const { data, error } = await client
      .from("home_tag_secrets")
      .select("join_key")
      .eq("tag_id", tagId)
      .maybeSingle();
    if (error) {
      throw toHomeError(error);
    }
    const key = (data as { join_key?: unknown } | null)?.join_key;
    return typeof key === "string" ? key : null;
  },

  async fetchMembers(tagId) {
    const client = requireClient();
    const { data, error } = await client
      .from("home_members")
      .select(MEMBER_COLUMNS)
      .eq("tag_id", tagId)
      .order("requested_at", { ascending: true });
    if (error) {
      throw toHomeError(error);
    }
    return parseMemberRows(data);
  },

  async fetchDisplayNames(userIds) {
    const names: Record<string, string> = {};
    if (userIds.length === 0) {
      return names;
    }
    const client = requireClient();
    for (const ids of chunk(userIds, ID_CHUNK)) {
      const { data, error } = await client
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      if (error) {
        throw toHomeError(error);
      }
      for (const row of (data ?? []) as unknown as ProfileRow[]) {
        names[row.user_id] = row.display_name;
      }
    }
    return names;
  },

  async fetchLatestAssessments(tagIds) {
    const latest: Record<string, StoredAssessment> = {};
    if (tagIds.length === 0) {
      return latest;
    }
    const client = requireClient();
    for (const ids of chunk(tagIds, ID_CHUNK)) {
      const { data, error } = await client
        .from("home_assessments")
        .select(ASSESSMENT_COLUMNS)
        .in("tag_id", ids)
        .order("created_at", { ascending: false });
      if (error) {
        throw toHomeError(error);
      }
      // Newest first: the first row seen for a tag is its latest.
      for (const assessment of parseAssessmentRows(data)) {
        if (!(assessment.tagId in latest)) {
          latest[assessment.tagId] = assessment;
        }
      }
    }
    return latest;
  },

  async fetchLatestSurvey(tagId) {
    const client = requireClient();
    const { data, error } = await client
      .from("home_surveys")
      .select("survey_id, tag_id, version, answers, created_at")
      .eq("tag_id", tagId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      throw toHomeError(error);
    }
    const row = Array.isArray(data) ? data[0] : null;
    const parsed = surveyRowSchema.safeParse(row);
    if (!parsed.success) {
      return null;
    }
    return {
      surveyId: parsed.data.survey_id,
      tagId: parsed.data.tag_id,
      version: parsed.data.version,
      answers: parsed.data.answers,
      createdAt: parsed.data.created_at,
    };
  },

  async saveSurvey({ tagId, version, answers }) {
    const client = requireClient();
    const userId = await requireUserId(client);
    const { data, error } = await client
      .from("home_surveys")
      .insert({ tag_id: tagId, user_id: userId, version, answers })
      .select("survey_id")
      .single();
    if (error) {
      throw toHomeError(error);
    }
    const surveyId = (data as { survey_id?: unknown } | null)?.survey_id;
    if (typeof surveyId !== "string") {
      throw new HomeError("unknown", "home_surveys: no survey id returned");
    }
    return surveyId;
  },

  async saveAssessment({ tagId, surveyId, assessment }) {
    const client = requireClient();
    const { error } = await client.from("home_assessments").insert({
      tag_id: tagId,
      survey_id: surveyId,
      method: assessment.method,
      ims_type_probs: assessment.ims_type_probs,
      vc_probs: assessment.vc_probs,
      vc_most_likely: assessment.vc_most_likely,
      vc_range: assessment.vc_range,
      confidence: assessment.confidence,
      hazard: assessment.hazard,
      review_status: "automatic",
    });
    if (error) {
      throw toHomeError(error);
    }
  },

  async uploadPhoto({ tagId, fileName, body, contentType }) {
    const client = requireClient();
    const { error } = await client.storage
      .from(HOME_PHOTOS_BUCKET)
      .upload(`${tagId}/${fileName}`, body, { contentType, upsert: false });
    if (error) {
      throw toHomeError(error);
    }
  },

  async fetchPhotoUrls(tagId) {
    const client = requireClient();
    const { data: files, error } = await client.storage
      .from(HOME_PHOTOS_BUCKET)
      .list(tagId);
    if (error) {
      throw toHomeError(error);
    }
    // Skips the folder placeholder object storage may keep next to the photos.
    const paths = (files ?? [])
      .filter((file) => /\.(jpe?g|png|webp)$/i.test(file.name))
      .map((file) => `${tagId}/${file.name}`);
    if (paths.length === 0) {
      return [];
    }
    const { data: signed, error: signError } = await client.storage
      .from(HOME_PHOTOS_BUCKET)
      .createSignedUrls(paths, 3600);
    if (signError) {
      throw toHomeError(signError);
    }
    return (signed ?? []).flatMap((entry) => (entry.signedUrl ? [entry.signedUrl] : []));
  },
};
