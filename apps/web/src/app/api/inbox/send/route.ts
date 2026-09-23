import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendEvent, recordActivity } from "@aporia/db";
import { openDecisionPoints, type Intent } from "@aporia/engine";
import { IntentOutputSchema, intentClassifierPrompt } from "@aporia/prompts";
import { ScenarioIndex } from "@aporia/scenario";
import { Names, getProvider, threadForPrompt } from "@aporia/worker";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

const Body = z.object({
  threadId: z.string().uuid().nullable().optional(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20_000),
  attachments: z.array(z.string()).default([]),
  quotedRefs: z.array(z.object({ documentId: z.string(), ref: z.string(), text: z.string().max(2000) })).default([]),
  /** Second step of the at-send sheet. */
  rationale: z.string().max(5000).nullable().optional(),
  decisionPointId: z.string().nullable().optional(),
  notMyAnswerYet: z.boolean().optional(),
  draftId: z.string().uuid().nullable().optional(),
});

/**
 * Send flow. First call classifies intent (fast Haiku). If the email is a
 * deliverable on a thread (or to recipients) with an open decision point, it
 * returns `needsRationale` and nothing leaves. The second call carries the
 * rationale (or notMyAnswerYet) and the email is appended.
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

  const threadId = parsed.data.threadId ?? randomUUID();
  const existing = parsed.data.threadId ? s.state.threads[parsed.data.threadId] : undefined;
  if (parsed.data.threadId && !existing) return Response.json({ error: "unknown thread" }, { status: 400 });
  const isDoctrine = to.includes(idx.doctrineAssistant.id);

  let intent: Intent | null = null;
  if (!isDoctrine) {
    if (parsed.data.notMyAnswerYet) intent = "question";
    else if (parsed.data.rationale != null) intent = "deliverable";
    else {
      const names = new Names(s.pkg, s.state.associateFirstName);
      const open = Object.entries(s.state.assignments).filter(([, a]) => a.status === "open").map(([id]) => idx.assignment(id));
      const onThread = open.find((a) => existing?.assignmentIds.includes(a.id)) ?? open.find((a) => a.expected_recipients.some((r) => to.includes(r) || cc.includes(r)));
      const p = intentClassifierPrompt({ thread: existing ? threadForPrompt(s.state, existing.id, names) : [], outgoing: { to: to.map((x) => names.name(x)), cc: cc.map((x) => names.name(x)), body: parsed.data.body, attachments: parsed.data.attachments }, openAssignmentTitle: onThread?.title ?? null });
      const provider = await getProvider();
      const res = await provider.generateJson({ role: "intent_classifier", system: p.system, user: p.user, promptVersion: p.version, mockContext: { body: parsed.data.body, openAssignmentTitle: onThread?.title ?? null }, sessionId: s.session.id }, IntentOutputSchema);
      intent = res.parsed.intent;
      if (intent === "deliverable") {
        const dps = openDecisionPoints(s.state, s.pkg, existing?.id ?? null, [...to, ...cc]);
        if (dps.length) {
          const d = dps[0]!;
          return Response.json({ needsRationale: true, intent, decisionPoint: { id: d.id, title: d.title, prompt: d.rationale_prompt } });
        }
      }
    }
  }
  const messageId = randomUUID();
  await appendEvent(s.session.id, {
    type: "email_sent",
    payload: { messageId, threadId, subject: parsed.data.subject ?? existing?.subject ?? "(no subject)", to, cc, body: parsed.data.body, attachments: parsed.data.attachments, quotedRefs: parsed.data.quotedRefs, rationale: parsed.data.rationale ?? null, decisionPointId: parsed.data.decisionPointId ?? null, intent, notMyAnswerYet: parsed.data.notMyAnswerYet ?? false },
  }, "associate", s.pkg);
  await recordActivity(s.session.id, new Date());
  if (parsed.data.draftId) await (await import("@aporia/db")).getPool().query(`delete from drafts where id = $1 and session_id = $2`, [parsed.data.draftId, s.session.id]);
  return Response.json({ ok: true, messageId, threadId, intent });
}
