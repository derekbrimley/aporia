import { agreementKappa } from "@aporia/evals";
import { apiUser } from "@/lib/auth";
export async function GET() {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  return Response.json(await agreementKappa());
}
