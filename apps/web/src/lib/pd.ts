import { getPool } from "@aporia/db";

export interface RosterRow { cohortId: string; cohortName: string; userId: string; name: string; email: string; status: "invited" | "not_started" | "in_progress" | "completed"; currentMilestone: string | null; lastActiveAt: string | null; activeMinutes: number; invitedAt: string }

/** Progress only: no scores, issue status or rationales. Associates write honest rationales because the firm cannot read them. */
export async function roster(orgId: string, cohortId?: string): Promise<RosterRow[]> {
  const r = await getPool().query<RosterRow>(
    `select c.id as "cohortId", c.name as "cohortName", u.id as "userId", u.name, u.email,
            case when s.id is null then 'invited' else s.status end as status,
            s.current_milestone as "currentMilestone", s.last_activity_at as "lastActiveAt", coalesce(s.active_seconds, 0) / 60 as "activeMinutes", u.invited_at as "invitedAt"
       from cohort_members cm join cohorts c on c.id = cm.cohort_id join users u on u.id = cm.user_id
       left join sessions s on s.user_id = u.id and s.cohort_id = c.id
      where c.org_id = $1 and u.removed_at is null and ($2::uuid is null or c.id = $2::uuid)
      order by c.name, u.name`,
    [orgId, cohortId ?? null],
  );
  return r.rows.map((x) => ({ ...x, status: x.status === "invited" && x.lastActiveAt === null ? (x.status as RosterRow["status"]) : x.status }));
}
