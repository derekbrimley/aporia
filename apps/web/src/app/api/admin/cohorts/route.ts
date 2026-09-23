import { z } from "zod";
import { getDb, getPool, schema } from "@aporia/db";
import { DEFAULT_SCENARIO_ID } from "@aporia/scenario";
import { apiUser, audit } from "@/lib/auth";
import { getScenario } from "@/lib/scenario";

const Body = z.object({ orgId: z.string().uuid().optional(), orgName: z.string().optional(), orgSlug: z.string().regex(/^[a-z0-9-]+$/).optional(), name: z.string().min(1), scenarioId: z.string().default(DEFAULT_SCENARIO_ID), startsOn: z.string().nullable().optional(), endsOn: z.string().nullable().optional(), assessorShadowMode: z.boolean().default(false), testerFlagsEnabled: z.boolean().default(true) });

export async function GET() {
  const u = await apiUser(["internal_admin", "pd_admin"]);
  if (u instanceof Response) return u;
  const r = await getPool().query(`select c.*, o.name as org_name, (select count(*) from cohort_members m where m.cohort_id = c.id)::int as members from cohorts c join organizations o on o.id = c.org_id where ($1::uuid is null or c.org_id = $1) order by c.created_at desc`, [u.role === "pd_admin" ? u.orgId : null]);
  return Response.json({ cohorts: r.rows });
}

/** Creates a cohort (and optionally the firm). Pinned to the current scenario version. */
export async function POST(req: Request) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const b = Body.parse(await req.json());
  const db = getDb();
  let orgId = b.orgId;
  if (!orgId) {
    if (!b.orgName || !b.orgSlug) return Response.json({ error: "orgId or orgName+orgSlug required" }, { status: 400 });
    const [o] = await db.insert(schema.organizations).values({ name: b.orgName, slug: b.orgSlug }).returning();
    orgId = o!.id;
  }
  const { pkg } = getScenario(b.scenarioId);
  const [c] = await db.insert(schema.cohorts).values({ orgId, name: b.name, scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, startsOn: b.startsOn ?? null, endsOn: b.endsOn ?? null, assessorShadowMode: b.assessorShadowMode, testerFlagsEnabled: b.testerFlagsEnabled }).returning();
  await audit(u, "cohort.create", c!.id, b);
  return Response.json({ cohort: c });
}
