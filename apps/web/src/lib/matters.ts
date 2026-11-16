import { cookies } from "next/headers";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@rematter/db";
import type { CurrentUser } from "./auth.js";
import { getScenario } from "./scenario.js";

/**
 * A "matter" is one simulation the associate is in: a cohort membership, pinned to one scenario.
 * Matters are kept fully separate. The one being worked on is remembered in this cookie; with a
 * single membership it is implied. The cookie only selects among the user's own cohorts, so a
 * forged value finds nothing.
 */
export const MATTER_COOKIE = "rematter_matter";

type Cohort = typeof schema.cohorts.$inferSelect;

export async function memberships(user: CurrentUser): Promise<Cohort[]> {
  const rows = await getDb()
    .select({ cohort: schema.cohorts })
    .from(schema.cohortMembers)
    .innerJoin(schema.cohorts, eq(schema.cohorts.id, schema.cohortMembers.cohortId))
    .where(
      and(eq(schema.cohortMembers.userId, user.id), eq(schema.cohortMembers.orgId, user.orgId)),
    )
    .orderBy(schema.cohortMembers.addedAt);
  return rows.map((r) => r.cohort);
}

/**
 * The same person can hold an associate account in more than one firm (one users row per org, same
 * email). Each account only sees its own firm's cohorts, so matters are listed across all of them:
 * this account first, then the others, oldest first. Signing in already proved the email.
 */
export async function siblingAccounts(user: CurrentUser): Promise<{ id: string; orgId: string }[]> {
  if (user.role !== "associate") return [{ id: user.id, orgId: user.orgId }];
  const rows = await getDb()
    .select({ id: schema.users.id, orgId: schema.users.orgId })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.email, user.email),
        eq(schema.users.role, "associate"),
        isNull(schema.users.removedAt),
      ),
    )
    .orderBy(sql`${schema.users.id} = ${user.id} desc`, asc(schema.users.invitedAt));
  return rows.length > 0 ? rows : [{ id: user.id, orgId: user.orgId }];
}

/** Every matter the person is in, across all their accounts, with the account it belongs to. */
export async function allMatters(user: CurrentUser): Promise<{ cohort: Cohort; userId: string }[]> {
  const accounts = await siblingAccounts(user);
  const rows = await getDb()
    .select({ cohort: schema.cohorts, userId: schema.cohortMembers.userId, orgId: schema.cohortMembers.orgId })
    .from(schema.cohortMembers)
    .innerJoin(schema.cohorts, eq(schema.cohorts.id, schema.cohortMembers.cohortId))
    .where(inArray(schema.cohortMembers.userId, accounts.map((a) => a.id)))
    .orderBy(schema.cohortMembers.addedAt);
  // Membership rows are org-scoped; keep only those in the account's own firm.
  const own = rows.filter((r) => accounts.some((a) => a.id === r.userId && a.orgId === r.orgId));
  const rank = (id: string) => accounts.findIndex((a) => a.id === id);
  return own.sort((a, b) => rank(a.userId) - rank(b.userId)).map((r) => ({ cohort: r.cohort, userId: r.userId }));
}

/**
 * The matter the user is working on: the remembered one, or the only one. Null cohort means they
 * must choose. `total` counts matters across all their accounts; `elsewhere` is a remembered matter
 * that belongs to another of their accounts, which the caller switches to.
 */
export async function activeMatter(
  user: CurrentUser,
): Promise<{ cohort: Cohort | null; all: Cohort[]; total: number; elsewhere: string | null }> {
  const everything = await allMatters(user);
  const all = everything.filter((m) => m.userId === user.id).map((m) => m.cohort);
  const chosen = (await cookies()).get(MATTER_COOKIE)?.value;
  const elsewhere = everything.find((m) => m.cohort.id === chosen && m.userId !== user.id)?.cohort.id ?? null;
  const cohort =
    all.find((c) => c.id === chosen) ?? (everything.length === 1 && all.length === 1 ? all[0]! : null);
  return { cohort, all, total: everything.length, elsewhere };
}

export interface MatterCard {
  cohortId: string;
  title: string;
  label: string;
  summary: string;
  status: "not_started" | "in_progress" | "completed";
  milestone: { order: number; title: string } | null;
  milestoneCount: number;
  lastActivityAt: string | null;
}

/** Everything the matter picker shows, one card per membership, most recently worked first. */
export async function listMatters(user: CurrentUser): Promise<MatterCard[]> {
  const all = await allMatters(user);
  const userIds = [...new Set(all.map((m) => m.userId))];
  const sessions = userIds.length
    ? await getDb()
        .select()
        .from(schema.sessions)
        .where(and(inArray(schema.sessions.userId, userIds), isNull(schema.sessions.archivedAt)))
    : [];
  const cards = all.map(({ cohort: c, userId }): MatterCard => {
    const { pkg } = getScenario(c.scenarioId, c.scenarioVersion);
    const s = sessions.find((x) => x.cohortId === c.id && x.userId === userId);
    const m = s?.currentMilestone
      ? pkg.milestones.find((x) => x.id === s.currentMilestone)
      : undefined;
    return {
      cohortId: c.id,
      title: pkg.meta.title.replace(/^Simulation \d+:\s*/, ""),
      label: pkg.meta.matter_label,
      summary: pkg.meta.summary,
      status: s?.status ?? "not_started",
      milestone: m ? { order: m.order, title: m.title } : null,
      milestoneCount: pkg.milestones.length,
      lastActivityAt: s?.lastActivityAt?.toISOString() ?? null,
    };
  });
  return cards.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
}
