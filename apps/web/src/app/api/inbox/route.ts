import { apiUser } from "@/lib/auth";
import { buildInboxView } from "@/lib/inbox";
import { bootstrapSession, sessionForUser } from "@/lib/session";
import { cohortCheckpoints } from "@/lib/checkpoints";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const boot = await bootstrapSession(u);
  if (!boot) return Response.json({ error: "You are not in a cohort yet. Ask your PD team for an invitation." }, { status: 404 });
  const s = (await sessionForUser(u))!;
  const view = await buildInboxView(s.session.id, s.state, s.pkg, { associateEmail: `${u.email.split("@")[0]}@${s.pkg.meta.associate.email_domain}`, testerFlagsEnabled: s.cohort.testerFlagsEnabled });
  // Test checkpoints, only in a cohort an admin pointed at a source run.
  const checkpoints = (await cohortCheckpoints(s.cohort))?.map((c) => ({ eventCount: c.eventCount, label: c.label, milestoneId: c.milestoneId })) ?? null;
  return Response.json({ ...view, checkpoints });
}
