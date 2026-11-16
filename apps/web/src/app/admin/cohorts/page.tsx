import { getPool } from "@rematter/db";
import { requireUser } from "@/lib/auth";
import { Shell } from "@/components/admin/Shell";
import { CohortAdmin } from "@/components/admin/CohortAdmin";
import { listScenarioIds } from "@rematter/scenario";
import { getScenario } from "@/lib/scenario";

export const dynamic = "force-dynamic";

export default async function CohortsPage() {
  const u = await requireUser(["internal_admin", "pd_admin"]);
  const cohorts = (await getPool().query(`select c.id, c.name, c.org_id as "orgId", o.name as "orgName", c.scenario_id as "scenarioId", c.scenario_version as "scenarioVersion", c.assessor_shadow_mode as "assessorShadowMode", (select count(*) from cohort_members m where m.cohort_id = c.id)::int as members from cohorts c join organizations o on o.id = c.org_id where ($1::uuid is null or c.org_id = $1) order by o.name, c.created_at desc`, [u.role === "pd_admin" ? u.orgId : null])).rows;
  const users = (await getPool().query(`select u.id, u.name, u.email, u.role, o.name as "orgName", u.last_seen_at as "lastSeenAt", u.removed_at as "removedAt",
      coalesce((select array_agg(c.name order by c.name) from cohort_members m join cohorts c on c.id = m.cohort_id where m.user_id = u.id), '{}') as cohorts,
      (select count(*) from users x where x.email = u.email and x.id <> u.id)::int as "otherFirms"
    from users u join organizations o on o.id = u.org_id where ($1::uuid is null or u.org_id = $1) order by o.name, u.removed_at nulls first, u.name`, [u.role === "pd_admin" ? u.orgId : null])).rows;
  const orgs = u.role === "internal_admin" ? (await getPool().query(`select id, name, slug from organizations order by name`)).rows : [];
  const scenarios = listScenarioIds().map((id) => { const m = getScenario(id).pkg.meta; return { id, title: m.title, version: m.version, status: m.status }; });
  return <Shell user={u} title={u.role === "pd_admin" ? "Cohorts and users" : "Firms, cohorts and users"}><CohortAdmin role={u.role} cohorts={JSON.parse(JSON.stringify(cohorts))} users={JSON.parse(JSON.stringify(users))} orgs={JSON.parse(JSON.stringify(orgs))} scenarios={scenarios} /></Shell>;
}
