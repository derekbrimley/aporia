import { apiUser } from "@/lib/auth";
import { listHeld } from "@/lib/admin";
export async function GET() {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  return Response.json({ held: await listHeld() });
}
