import { apiUser } from "@/lib/auth";
import { roster } from "@/lib/pd";

export async function GET(req: Request) {
  const u = await apiUser(["pd_admin", "internal_admin"]);
  if (u instanceof Response) return u;
  const cohortId = new URL(req.url).searchParams.get("cohortId") ?? undefined;
  return Response.json({ roster: await roster(u.orgId, cohortId) });
}
