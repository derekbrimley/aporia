import { z } from "zod";
import { getPool } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

const Draft = z.object({ id: z.string().uuid().optional(), threadId: z.string().uuid().nullable(), to: z.array(z.string()), cc: z.array(z.string()), subject: z.string().nullable(), body: z.string(), attachments: z.array(z.string()) });

export async function GET() {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ drafts: [] });
  const r = await getPool().query(`select id, thread_id as "threadId", "to", cc, subject, body, attachments, updated_at as "updatedAt" from drafts where session_id = $1 order by updated_at desc`, [s.session.id]);
  return Response.json({ drafts: r.rows });
}

/** Autosave: upserts a draft. */
export async function PUT(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  const d = Draft.parse(await req.json());
  const r = await getPool().query<{ id: string }>(
    `insert into drafts (id, org_id, session_id, thread_id, "to", cc, subject, body, attachments, updated_at) values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (id) do update set thread_id = excluded.thread_id, "to" = excluded."to", cc = excluded.cc, subject = excluded.subject, body = excluded.body, attachments = excluded.attachments, updated_at = now() returning id`,
    [d.id ?? null, u.orgId, s.session.id, d.threadId, JSON.stringify(d.to), JSON.stringify(d.cc), d.subject, d.body, JSON.stringify(d.attachments)],
  );
  return Response.json({ id: r.rows[0]!.id });
}

export async function DELETE(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ ok: true });
  const { id } = (await req.json()) as { id: string };
  await getPool().query(`delete from drafts where id = $1 and session_id = $2`, [id, s.session.id]);
  return Response.json({ ok: true });
}
