import { CaseError, buildFlagCase } from "@rematter/evals";
import { apiUser, audit } from "@/lib/auth";

/**
 * Downloads an eval case built from a tester flag: the session up to the flagged email, ready for
 * `pnpm evals:cases` to replay. Save it in packages/evals/cases/.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  try {
    const c = await buildFlagCase(id);
    await audit(u, "flag.eval_case", id, { caseId: c.id });
    return new Response(JSON.stringify(c, null, 2) + "\n", {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${c.id}.json"` },
    });
  } catch (e) {
    if (e instanceof CaseError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
