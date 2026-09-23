import { apiUser } from "@/lib/auth";
import { listFlags } from "@/lib/admin";
export async function GET(req: Request) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  return Response.json({ flags: await listFlags(new URL(req.url).searchParams.get("status") ?? undefined) });
}
