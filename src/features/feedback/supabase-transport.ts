import type { SupabaseClient } from "@supabase/supabase-js";
import { File } from "expo-file-system";
import { Platform } from "react-native";

import { getSupabaseClient, signInAnonymously } from "@/lib/supabase";

import type {
  FeedbackPhotoUploadResult,
  FeedbackTransport,
  FeedbackTransportResult,
} from "./queue";
import type { FeedbackPhotoAttachment, FeedbackSubmission } from "./types";

/** Private Storage bucket created by migration 0020 — see that file for the
 * bucket config (5 MB limit, jpeg/png/webp) and the storage.objects RLS
 * policies this upload path depends on. Deliberately NOT `felt-photos`
 * (migration 0016) — the wave brief is explicit the two must stay separate
 * buckets so retention/deletion policies can differ later. */
const FEEDBACK_PHOTOS_BUCKET = "feedback-photos";

/** Postgres unique-violation error code — same idempotency trick migration
 * 0020's own "runaway-client guard" comment documents: `feedback_id` is the
 * client-generated PK, so a retry of an already-landed insert hits this
 * code and is treated as success, never a user-visible failure. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export interface FeedbackInsert {
  feedback_id: string;
  device_id: string;
  user_id: string | null;
  message: string;
  contact: string | null;
  app_version: string | null;
  locale: string | null;
  platform: string | null;
  screen: string | null;
  created_at: string;
}

/**
 * Maps a `FeedbackSubmission` to a `feedback` insert row (migration 0020).
 * Deliberately NOT sent (left to the database): `created_at`'s server-side
 * default is never used — the client's own capture time IS sent (matching
 * `buildFeltReportInsert`'s `created_at`, "captured on-device"), since a
 * feedback message may sit in the offline queue for a while before this
 * insert is attempted and the on-device moment is the truthful one.
 */
export function buildFeedbackInsert(
  submission: FeedbackSubmission,
  userId: string | null = null,
): FeedbackInsert {
  return {
    feedback_id: submission.feedbackId,
    device_id: submission.deviceId,
    user_id: userId,
    message: submission.message,
    contact: submission.contact,
    app_version: submission.context.appVersion,
    locale: submission.context.locale,
    platform: submission.context.platform,
    screen: submission.context.screen,
    created_at: new Date(submission.createdAt).toISOString(),
  };
}

export interface FeedbackPhotoInsert {
  photo_id: string;
  feedback_id: string;
  storage_path: string;
}

/** Maps a resolved storage path to a `feedback_photos` upsert row. As of
 * migration 0021, the upsert key is `photo_id` (client-generated, one per
 * photo), not `feedback_id` (which 0020 had capped at one row and 0021
 * drops that cap on) — see 0021's own header for why the idempotency
 * anchor moved. */
export function buildFeedbackPhotoInsert(
  photoId: string,
  feedbackId: string,
  storagePath: string,
): FeedbackPhotoInsert {
  return { photo_id: photoId, feedback_id: feedbackId, storage_path: storagePath };
}

/** True for any Postgres/PostgREST error that isn't a known "this was
 * already inserted" case — mirrors `src/features/felt/supabase-transport.ts`'s
 * own `isRetryableInsertError`: the safe default for an offline-queue
 * transport is "retry", never "give up silently". */
function isRetryableInsertError(errorCode: string | undefined): boolean {
  return errorCode !== POSTGRES_UNIQUE_VIOLATION;
}

/**
 * Ensures an anonymous Supabase Auth session exists and returns its
 * `auth.uid()`, or `null` on ANY failure — mirrors
 * `src/features/felt/supabase-transport.ts`'s `ensureAnonymousUserId`
 * exactly (a parallel implementation, not shared code, matching this
 * feature's own "mirror, don't couple two unrelated domains" stance — see
 * `queue.ts`'s header comment). Every caller here treats `null` as
 * "degrade gracefully": feedback must still submit fine when anonymous
 * sign-in fails.
 */
async function ensureAnonymousUserId(client: SupabaseClient): Promise<string | null> {
  try {
    await signInAnonymously();
  } catch {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    return null;
  }
  return data.session.user.id;
}

/** `image/jpeg` unless the local URI's own extension says otherwise —
 * mirrors `src/features/felt/supabase-transport.ts`'s
 * `inferPhotoContentType`, narrowed to the three mime types migration
 * 0020's bucket allows. */
function inferPhotoContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

/**
 * Reads a LOCAL photo uri's bytes into whatever body shape `@supabase/
 * storage-js`'s `upload()` accepts directly — identical to
 * `src/features/felt/supabase-transport.ts`'s `readPhotoBody` (web:
 * `fetch(uri).blob()`; native: `expo-file-system`'s `File#arrayBuffer()`).
 * Duplicated rather than imported: the two transports are independent
 * features that happen to need the same small platform shim, not a shared
 * dependency worth coupling them over.
 */
async function readPhotoBody(uri: string): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    return await response.blob();
  }
  return await new File(uri).arrayBuffer();
}

/**
 * Uploads ONE feedback screenshot to the private `feedback-photos` Storage
 * bucket at `<auth.uid()>/<feedback_id>/<photo_id>.jpg` (migration 0021 —
 * was `<auth.uid()>/<feedback_id>.jpg` under 0020, before more than one
 * photo was possible), then upserts the matching `feedback_photos` row
 * keyed on `photo_id`. Never throws — every failure path returns
 * `{ outcome: "failed" }` so `queue.ts`'s per-photo retry pass can safely
 * re-attempt just THIS photo on the next drain without the surrounding
 * feedback message, or any sibling photo, ever being affected (wave
 * brief: "the message must submit successfully even if the photo upload
 * fails or is slow"; "each photo uploads independently ... one photo
 * failing must not prevent the others from uploading").
 */
export async function uploadFeedbackPhoto(
  client: SupabaseClient,
  submission: FeedbackSubmission,
  photo: FeedbackPhotoAttachment,
): Promise<FeedbackPhotoUploadResult> {
  const userId = await ensureAnonymousUserId(client);
  if (!userId) {
    // No provable identity -> no safe storage path to write to (migration
    // 0020's RLS predicate requires the path's first segment to equal
    // auth.uid()). Defer, never drop: the feedback message itself already
    // succeeded independently of this call.
    return { outcome: "failed" };
  }

  try {
    const body = await readPhotoBody(photo.uri);
    const storagePath = `${userId}/${submission.feedbackId}/${photo.photoId}.jpg`;

    const { error: uploadError } = await client.storage
      .from(FEEDBACK_PHOTOS_BUCKET)
      .upload(storagePath, body, {
        upsert: true, // retry-idempotent: re-running this on the same path overwrites, never duplicates
        contentType: inferPhotoContentType(photo.uri),
      });
    if (uploadError) {
      return { outcome: "failed" };
    }

    const { error: rowError } = await client
      .from("feedback_photos")
      .upsert(buildFeedbackPhotoInsert(photo.photoId, submission.feedbackId, storagePath), {
        onConflict: "photo_id",
      });
    if (rowError) {
      return { outcome: "failed" };
    }

    return { outcome: "uploaded" };
  } catch {
    return { outcome: "failed" };
  }
}

export const SupabaseFeedbackTransport: FeedbackTransport = {
  async submit(submission: FeedbackSubmission): Promise<FeedbackTransportResult> {
    const client = getSupabaseClient();
    if (!client) {
      // Defensive only — queue.ts selects this transport exclusively when
      // `isSupabaseConfigured()` is true. Matches `PendingFeedbackTransport`'s
      // own "nothing was attempted, nothing was lost" semantics.
      return { outcome: "awaiting-backend" };
    }

    const userId = await ensureAnonymousUserId(client);

    const { error } = await client
      .from("feedback")
      .insert(buildFeedbackInsert(submission, userId));

    if (!error) {
      return { outcome: "submitted", serverFeedbackId: submission.feedbackId };
    }
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      // feedback_id is the client-generated UUID reused as the row's PK
      // specifically so this case is detectable — see migration 0020's own
      // "runaway-client guard" comment.
      return { outcome: "submitted", serverFeedbackId: submission.feedbackId };
    }
    return { outcome: "failed", retryable: isRetryableInsertError(error.code) };
  },

  async uploadPhoto(
    submission: FeedbackSubmission,
    photo: FeedbackPhotoAttachment,
  ): Promise<FeedbackPhotoUploadResult> {
    const client = getSupabaseClient();
    if (!client) {
      return { outcome: "failed" };
    }
    return uploadFeedbackPhoto(client, submission, photo);
  },
};
