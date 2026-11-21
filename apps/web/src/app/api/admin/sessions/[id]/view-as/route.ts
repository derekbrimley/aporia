import { cookies } from "next/headers";
import { getPool } from "@rematter/db";
import { apiUser, audit, startImpersonating } from "@/lib/auth";
import { env } from "@/lib/env";
import { MATTER_COOKIE } from "@/lib/matters";

/**
 * "View as tester": signs the admin in as the associate who owns this session, read-only, with that
 * session's matter open. A banner on every page leads back to the admin account.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  const s = (
    await getPool().query<{ user_id: string; cohort_id: string; role: string; removed_at: Date | null }>(
      `select s.user_id, s.cohort_id, u.role, u.removed_at from sessions s join users u on u.id = s.user_id where s.id = $1`,
      [id],
    )
  ).rows[0];
  if (!s) return Response.json({ error: "No session with that id." }, { status: 404 });
  if (s.role !== "associate") return Response.json({ error: "Only an associate's session can be viewed as them." }, { status: 400 });
  if (s.removed_at) return Response.json({ error: "That user has been removed." }, { status: 400 });
  await audit(u, "user.view_as.start", s.user_id, { sessionId: id });
  await startImpersonating(u, s.user_id, `/admin/sessions/${id}`);
  (await cookies()).set(MATTER_COOKIE, s.cohort_id, { path: "/", sameSite: "lax", secure: env.isProd });
  // Not req.url: behind Railway's proxy that is the container's own address (http://localhost:8080).
  return Response.redirect(`${env.appUrl}/`, 303);
}
