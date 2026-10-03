import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendEvent, recordActivity } from "@aporia/db";
import { ScenarioIndex } from "@aporia/scenario";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

const Body = z.object({
  threadId: z.string().uuid().nullable().optional(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().max(200).nullable().optional(),
  // May be empty only on a forward: the forwarded email is the content.
  body: z.string().max(20_000),
  attachments: z.array(z.string()).default([]),
  quotedRefs: z.array(z.object({ documentId: z.string(), ref: z.string(), text: z.string().max(2000) })).default([]),
  draftId: z.string().uuid().nullable().optional(),
  forwardedMessageId: z.string().uuid().nullable().optional(),
});

/**
 * Send flow: the email is appended as written, with no questions at send. The
 * worker classifies its intent; the engine decides whether it is a deliverable
 * (assessing a question-shaped one first) and who in the world responds.
 */
export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  if (s.state.status === "completed") return Response.json({ error: "The deal has closed; the inbox is read-only." }, { status: 409 });
  const idx = new ScenarioIndex(s.pkg);
  const resolve = (emails: string[]) => emails.map((e) => idx.characterByEmail(e)?.id).filter((x): x is string => Boolean(x));
  const to = resolve(parsed.data.to);
  const cc = resolve(parsed.data.cc);
  if (!to.length) return Response.json({ error: "No recipient is on this deal's address book." }, { status: 400 });
  for (const d of parsed.data.attachments) if (!s.state.documentsReleased.includes(d)) return Response.json({ error: `Document ${d} is not in your inbox.` }, { status: 400 });

  const fwdId = parsed.data.forwardedMessageId ?? null;
  const fwd = fwdId ? s.state.messages[fwdId] : undefined;
  if (fwdId && !fwd) return Response.json({ error: "unknown message to forward" }, { status: 400 });
  // Practice support threads stay private to the associate.
  if (fwd && s.state.threads[fwd.threadId]?.hidden) return Response.json({ error: "Practice support answers can't be forwarded." }, { status: 400 });
  if (fwd && parsed.data.threadId) return Response.json({ error: "A forward starts a new thread." }, { status: 400 });
  if (!parsed.data.body.trim() && !fwd) return Response.json({ error: "The email is empty." }, { status: 400 });

  const threadId = parsed.data.threadId ?? randomUUID();
  const existing = parsed.data.threadId ? s.state.threads[parsed.data.threadId] : undefined;
  if (parsed.data.threadId && !existing) return Response.json({ error: "unknown thread" }, { status: 400 });
  const messageId = randomUUID();
  await appendEvent(s.session.id, {
    type: "email_sent",
    payload: { messageId, threadId, subject: parsed.data.subject ?? existing?.subject ?? "(no subject)", to, cc, body: parsed.data.body, attachments: parsed.data.attachments, quotedRefs: parsed.data.quotedRefs, forwardedMessageId: fwd?.id ?? null },
  }, "associate", s.pkg);
  await recordActivity(s.session.id, new Date());
  if (parsed.data.draftId) await (await import("@aporia/db")).getPool().query(`delete from drafts where id = $1 and session_id = $2`, [parsed.data.draftId, s.session.id]);
  return Response.json({ ok: true, messageId, threadId });
}
