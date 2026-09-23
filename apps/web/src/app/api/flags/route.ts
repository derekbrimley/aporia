import { z } from "zod";
import { appendEvent, getDb, schema } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

const Body = z.object({ targetType: z.enum(["message", "document"]), targetId: z.string(), note: z.string().min(1).max(300) });

/** Tester flag: out of fiction; sends nothing to characters. */
export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  if (!s.cohort.testerFlagsEnabled) return Response.json({ error: "flags disabled" }, { status: 403 });
  const b = Body.parse(await req.json());
  await getDb().insert(schema.flags).values({ orgId: u.orgId, sessionId: s.session.id, userId: u.id, targetType: b.targetType, targetId: b.targetId, note: b.note });
  await appendEvent(s.session.id, { type: "flag_raised", payload: b }, "associate", s.pkg);
  return Response.json({ ok: true });
}
