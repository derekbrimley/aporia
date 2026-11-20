import { apiUser } from "@/lib/auth";
import { buildInboxView } from "@/lib/inbox";
import { bootstrapSession, sessionForUser } from "@/lib/session";
import { cohortCheckpoints } from "@/lib/checkpoints";
import { activeMatter } from "@/lib/matters";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  // An admin viewing as the tester only looks: no starting the session, no "resumed" event, no activity.
  const boot = u.impersonator ? await sessionForUser(u) : await bootstrapSession(u);
  if (!boot) {
    if (u.impersonator) return Response.json({ error: `${u.name} hasn't opened this matter yet, so there is nothing to show.` }, { status: 404 });
    const { total } = await activeMatter(u);
    if (total > 0) return Response.json({ error: "Choose a matter to open.", choose: true }, { status: 409 });
    return Response.json({ error: "You are not in a cohort yet. Ask your PD team for an invitation." }, { status: 404 });
  }
  const matterCount = (await activeMatter(u)).total;
  const s = (await sessionForUser(u))!;
  const view = await buildInboxView(s.session.id, s.state, s.pkg, { associateEmail: `${u.email.split("@")[0]}@${s.pkg.meta.associate.email_domain}`, testerFlagsEnabled: s.cohort.testerFlagsEnabled });
  // Test checkpoints, only in a cohort an admin pointed at a source run.
  const checkpoints = (await cohortCheckpoints(s.cohort))?.map((c) => ({ eventCount: c.eventCount, label: c.label, milestoneId: c.milestoneId })) ?? null;
  return Response.json({ ...view, viewingAs: u.impersonator ? u.name : null, checkpoints: u.impersonator ? null : checkpoints, matterCount });
}
