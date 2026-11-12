import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
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

/** The matter the user is working on: the remembered one, or the only one. Null cohort means they must choose. */
export async function activeMatter(
  user: CurrentUser,
): Promise<{ cohort: Cohort | null; all: Cohort[] }> {
  const all = await memberships(user);
  const chosen = (await cookies()).get(MATTER_COOKIE)?.value;
  const cohort = all.find((c) => c.id === chosen) ?? (all.length === 1 ? all[0]! : null);
  return { cohort, all };
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
  const all = await memberships(user);
  const sessions = await getDb()
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, user.id),
        eq(schema.sessions.orgId, user.orgId),
        isNull(schema.sessions.archivedAt),
      ),
    );
  const cards = all.map((c): MatterCard => {
    const { pkg } = getScenario(c.scenarioId, c.scenarioVersion);
    const s = sessions.find((x) => x.cohortId === c.id);
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
