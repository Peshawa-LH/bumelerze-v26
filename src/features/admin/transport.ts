import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { HUB_ROLE_KINDS } from "@/features/eventhub/types";
import { getSupabaseClient } from "@/lib/supabase";
import type { GrantableRank, QueueComment, ReportedProfile, RoleHolder } from "./types";

/**
 * Admin data access (migrations 0044 and 0046-0047). Every function checks
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
};
