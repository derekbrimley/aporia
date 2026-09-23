import { getPool } from "@aporia/db";
import { apiUser, audit } from "@/lib/auth";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  const { status } = (await req.json()) as { status: "open" | "triaged" | "dismissed" };
  await getPool().query(`update flags set status = $2 where id = $1`, [id, status]);
  await audit(u, "flag.triage", id, { status });
  return Response.json({ ok: true });
}
