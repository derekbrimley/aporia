import { getPool } from "@aporia/db";
import { requireUser } from "@/lib/auth";
import { Shell } from "@/components/admin/Shell";
import { CohortAdmin } from "@/components/admin/CohortAdmin";

export const dynamic = "force-dynamic";

export default async function CohortsPage() {
  const u = await requireUser(["internal_admin", "pd_admin"]);
  const cohorts = (await getPool().query(`select c.id, c.name, c.org_id as "orgId", o.name as "orgName", c.scenario_id as "scenarioId", c.scenario_version as "scenarioVersion", c.assessor_shadow_mode as "assessorShadowMode", (select count(*) from cohort_members m where m.cohort_id = c.id)::int as members from cohorts c join organizations o on o.id = c.org_id where ($1::uuid is null or c.org_id = $1) order by o.name, c.created_at desc`, [u.role === "pd_admin" ? u.orgId : null])).rows;
  const orgs = u.role === "internal_admin" ? (await getPool().query(`select id, name, slug from organizations order by name`)).rows : [];
  return <Shell user={u} title="Cohorts and users"><CohortAdmin role={u.role} cohorts={JSON.parse(JSON.stringify(cohorts))} orgs={JSON.parse(JSON.stringify(orgs))} /></Shell>;
}
