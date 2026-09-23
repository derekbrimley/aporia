import { z } from "zod";
import { getDb, getPool, schema } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { ratingSample } from "@/lib/admin";

const Body = z.object({ messageId: z.string().uuid(), realism: z.number().int().min(1).max(5), legalAccuracy: z.number().int().min(1).max(5), socraticQuality: z.number().int().min(1).max(5), voiceConsistency: z.number().int().min(1).max(5), acceptable: z.boolean(), notes: z.string().max(2000).optional() });

export async function GET() {
  const u = await apiUser(["internal_admin", "internal_rater"]);
  if (u instanceof Response) return u;
  return Response.json({ sample: await ratingSample() });
}

export async function POST(req: Request) {
  const u = await apiUser(["internal_admin", "internal_rater"]);
  if (u instanceof Response) return u;
  const b = Body.parse(await req.json());
  const m = (await getPool().query<{ org_id: string; session_id: string }>(`select org_id, session_id from messages where id = $1`, [b.messageId])).rows[0];
  if (!m) return Response.json({ error: "unknown message" }, { status: 404 });
  await getDb().insert(schema.ratings).values({ orgId: m.org_id, sessionId: m.session_id, messageId: b.messageId, raterType: "human", raterId: u.id, realism: b.realism, legalAccuracy: b.legalAccuracy, socraticQuality: b.socraticQuality, voiceConsistency: b.voiceConsistency, acceptable: b.acceptable, notes: b.notes ?? null });
  return Response.json({ ok: true });
}
