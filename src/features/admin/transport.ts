import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { HUB_ROLE_KINDS } from "@/features/eventhub/types";
import { getSupabaseClient } from "@/lib/supabase";
import {
  ACTIVITY_PAGE_SIZE,
  type ActivityEntry,
  type ActivityFilters,
  type GrantableRank,
  type QueueComment,
  type ReportedPost,
  type FoundAccount,
  type ReportedProfile,
  type RoleHolder,
} from "./types";

/**
 * Admin data access (migrations 0044, 0046-0047, 0050-0052). Every function checks
 * the caller's permission on the server; the app only decides what to show.
 */
export interface AdminTransport {
  fetchQueue(): Promise<QueueComment[]>;
  fetchRoleHolders(): Promise<RoleHolder[]>;
  fetchReportedProfiles(): Promise<ReportedProfile[]>;
  grantRole(input: {
    username: string;
    role: GrantableRank;
    orgName?: string | null;
    note?: string | null;
  }): Promise<void>;
  revokeRole(username: string, role: GrantableRank): Promise<void>;
  resolveProfileReports(userId: string): Promise<void>;
  /** Reported profile posts (`post_queue()`, 0050). Throws `unavailable`
   * before the migration is applied. */
  fetchReportedPosts(): Promise<ReportedPost[]>;
  dismissPostReports(postId: string): Promise<void>;
  /** Accounts matching a username prefix or an exact email
   * (`admin_find_accounts`, 0051). */
  findAccounts(query: string): Promise<FoundAccount[]>;
  /** Sets a new password for an account (`admin_reset_password`, 0051). */
  resetPassword(userId: string, newPassword: string): Promise<void>;
  /** One page of the activity log (`admin_activity`, 0052), newest first.
   * `before` is the `cursor` of the last row of the previous page. */
  fetchActivity(
    filters: ActivityFilters,
    before: string | null,
  ): Promise<ActivityEntry[]>;
}

const queueSchema = z.object({
  comment_id: z.string(),
  event_id: z.string(),
  hub_id: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  author_name: z.string().nullable().optional(),
  body: z.string(),
  status: z.enum(["pending", "visible"]),
  flag_count: z.coerce.number().catch(0),
  created_at: z.string(),
});

export function parseQueue(data: unknown): QueueComment[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: QueueComment[] = [];
  for (const row of data) {
    const parsed = queueSchema.safeParse(row);
    const createdAt = parsed.success ? Date.parse(parsed.data.created_at) : NaN;
    if (!parsed.success || Number.isNaN(createdAt)) {
      continue;
    }
    rows.push({
      id: parsed.data.comment_id,
      eventId: parsed.data.event_id,
      hubId: parsed.data.hub_id ?? null,
      authorId: parsed.data.author_id ?? null,
      authorName: parsed.data.author_name ?? null,
      body: parsed.data.body,
      status: parsed.data.status,
      flagCount: parsed.data.flag_count,
      createdAt,
    });
  }
  return rows;
}

const holderSchema = z.object({
  holder_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  role: z.string(),
  org_name: z.string().nullable().optional(),
  granted_at: z.string(),
  granted_by_name: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export function parseRoleHolders(data: unknown): RoleHolder[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: RoleHolder[] = [];
  for (const row of data) {
    const parsed = holderSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const role = HUB_ROLE_KINDS.find((kind) => kind === parsed.data.role);
    if (!role) {
      continue;
    }
    const grantedAt = Date.parse(parsed.data.granted_at);
    rows.push({
      userId: parsed.data.holder_id,
      username: parsed.data.username ?? null,
      displayName: parsed.data.display_name ?? null,
      role,
      orgName: parsed.data.org_name ?? null,
      grantedAt: Number.isNaN(grantedAt) ? 0 : grantedAt,
      grantedByName: parsed.data.granted_by_name ?? null,
      note: parsed.data.note ?? null,
    });
  }
  return rows;
}

const reportSchema = z.object({
  reported_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  report_count: z.coerce.number().catch(0),
  last_reason: z.string().nullable().optional(),
});

export function parseReportedProfiles(data: unknown): ReportedProfile[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: ReportedProfile[] = [];
  for (const row of data) {
    const parsed = reportSchema.safeParse(row);
    if (parsed.success) {
      rows.push({
        userId: parsed.data.reported_id,
        username: parsed.data.username ?? null,
        displayName: parsed.data.display_name ?? null,
        reportCount: parsed.data.report_count,
        lastReason: parsed.data.last_reason ?? null,
      });
    }
  }
  return rows;
}

const postSchema = z.object({
  post_id: z.string(),
  author_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  body: z.string(),
  report_count: z.coerce.number().catch(0),
  last_reason: z.string().nullable().optional(),
});

export function parseReportedPosts(data: unknown): ReportedPost[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: ReportedPost[] = [];
  for (const row of data) {
    const parsed = postSchema.safeParse(row);
    if (parsed.success) {
      rows.push({
        postId: parsed.data.post_id,
        authorId: parsed.data.author_id,
        username: parsed.data.username ?? null,
        displayName: parsed.data.display_name ?? null,
        body: parsed.data.body,
        reportCount: parsed.data.report_count,
        lastReason: parsed.data.last_reason ?? null,
      });
    }
  }
  return rows;
}

const foundSchema = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  masked_email: z.string().nullable().optional(),
});

export function parseFoundAccounts(data: unknown): FoundAccount[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: FoundAccount[] = [];
  for (const row of data) {
    const parsed = foundSchema.safeParse(row);
    if (parsed.success) {
      rows.push({
        userId: parsed.data.user_id,
        username: parsed.data.username ?? null,
        displayName: parsed.data.display_name ?? null,
        maskedEmail: parsed.data.masked_email ?? null,
      });
    }
  }
  return rows;
}

const activitySchema = z.object({
  log_id: z.string(),
  created_at: z.string(),
  action: z.string(),
  actor_id: z.string().nullable().optional(),
  actor_name: z.string().nullable().optional(),
  actor_username: z.string().nullable().optional(),
  actor_rank: z.string().nullable().optional(),
  target_type: z.string().nullable().optional(),
  target_id: z.string().nullable().optional(),
  target_user_id: z.string().nullable().optional(),
  target_name: z.string().nullable().optional(),
  target_username: z.string().nullable().optional(),
  target_summary: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  reverted_by: z.string().nullable().optional(),
});

export function parseActivity(data: unknown): ActivityEntry[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: ActivityEntry[] = [];
  for (const row of data) {
    const parsed = activitySchema.safeParse(row);
    const createdAt = parsed.success ? Date.parse(parsed.data.created_at) : NaN;
    if (!parsed.success || Number.isNaN(createdAt)) {
      continue;
    }
    const d = parsed.data;
    rows.push({
      id: d.log_id,
      cursor: d.created_at,
      createdAt,
      action: d.action,
      actorId: d.actor_id ?? null,
      actorName: d.actor_name ?? null,
      actorUsername: d.actor_username ?? null,
      actorRank: HUB_ROLE_KINDS.find((kind) => kind === d.actor_rank) ?? null,
      targetType: d.target_type ?? null,
      targetId: d.target_id ?? null,
      targetUserId: d.target_user_id ?? null,
      targetName: d.target_name ?? null,
      targetUsername: d.target_username ?? null,
      targetSummary: d.target_summary ?? null,
      reason: d.reason ?? null,
      note: d.note ?? null,
      revertedBy: d.reverted_by ?? null,
    });
  }
  return rows;
}

async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
  return data;
}

export const SupabaseAdminTransport: AdminTransport = {
  async fetchQueue() {
    return parseQueue(await call("moderation_queue", { p_limit: 50 }));
  },
  async fetchRoleHolders() {
    return parseRoleHolders(await call("admin_role_holders"));
  },
  async fetchReportedProfiles() {
    return parseReportedProfiles(await call("moderation_profile_reports"));
  },
  async grantRole({ username, role, orgName, note }) {
    await call("admin_grant_role", {
      p_username: username,
      p_role: role,
      p_org_name: orgName ?? null,
      p_note: note ?? null,
    });
  },
  async revokeRole(username, role) {
    await call("admin_revoke_role", { p_username: username, p_role: role });
  },
  async resolveProfileReports(userId) {
    await call("resolve_profile_reports", { p_user: userId });
  },
  async fetchReportedPosts() {
    return parseReportedPosts(await call("post_queue", { p_limit: 50 }));
  },
  async dismissPostReports(postId) {
    await call("dismiss_post_reports", { p_post_id: postId });
  },
  async findAccounts(query) {
    return parseFoundAccounts(await call("admin_find_accounts", { p_query: query }));
  },
  async fetchActivity(filters, before) {
    return parseActivity(
      await call("admin_activity", {
        p_actor: null,
        p_action: filters.action,
        p_target_user: filters.targetUserId,
        p_before: before,
        p_limit: ACTIVITY_PAGE_SIZE,
      }),
    );
  },
  async resetPassword(userId, newPassword) {
    await call("admin_reset_password", {
      p_user_id: userId,
      p_new_password: newPassword,
    });
  },
};
