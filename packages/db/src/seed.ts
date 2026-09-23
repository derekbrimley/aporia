import { eq } from "drizzle-orm";
import { ENGINE_VERSION } from "@aporia/engine";
import type { ScenarioPackage } from "@aporia/scenario";
import type { Db } from "./client.js";
import * as t from "./schema.js";
import { ensureSession } from "./runtime.js";

export interface SeedResult {
  orgId: string;
  cohortId: string;
  associateId: string;
  pdAdminId: string;
  internalAdminId: string;
  raterId: string;
  sessionId: string;
}

/** Creates a firm, a cohort and the four role users. Idempotent on the org slug. */
export async function seedDevData(db: Db, pkg: ScenarioPackage, opts: { slug?: string; testMode?: boolean } = {}): Promise<SeedResult> {
  const slug = opts.slug ?? "dev-firm";
  let org = (await db.select().from(t.organizations).where(eq(t.organizations.slug, slug)))[0];
  if (!org) [org] = await db.insert(t.organizations).values({ name: "Dev Firm LLP", slug }).returning();
  const user = async (email: string, name: string, role: (typeof t.users.$inferInsert)["role"]) => {
    const existing = (await db.select().from(t.users).where(eq(t.users.email, email)))[0];
    if (existing) return existing;
    const [u] = await db.insert(t.users).values({ orgId: org!.id, email, name, firstName: name.split(" ")[0]!, role }).returning();
    return u!;
  };
  const associate = await user(`associate@${slug}.example`, "Sam Okoro", "associate");
  const pd = await user(`pd@${slug}.example`, "Dana Whitcombe", "pd_admin");
  const admin = await user(`admin@${slug}.example`, "Internal Admin", "internal_admin");
  const rater = await user(`rater@${slug}.example`, "Internal Rater", "internal_rater");
  let cohort = (await db.select().from(t.cohorts).where(eq(t.cohorts.orgId, org!.id)))[0];
  if (!cohort) [cohort] = await db.insert(t.cohorts).values({ orgId: org!.id, name: "Pilot cohort 1", scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version }).returning();
  await db.insert(t.cohortMembers).values({ cohortId: cohort!.id, userId: associate.id, orgId: org!.id }).onConflictDoNothing();
  const session = await ensureSession(db, { orgId: org!.id, userId: associate.id, cohortId: cohort!.id, scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: ENGINE_VERSION, testMode: opts.testMode ?? true });
  return { orgId: org!.id, cohortId: cohort!.id, associateId: associate.id, pdAdminId: pd.id, internalAdminId: admin.id, raterId: rater.id, sessionId: session.id };
}
