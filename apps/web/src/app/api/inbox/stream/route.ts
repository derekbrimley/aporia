import { getPool } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Server-sent events: new messages and state changes, polled from the projection every 2 seconds. */
export async function GET(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return new Response("no session", { status: 404 });
  const sessionId = s.session.id;
  let lastSeq = Number(new URL(req.url).searchParams.get("since") ?? 0);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const tick = async () => {
        if (closed) return;
        try {
          const r = await getPool().query<{ seq: number }>(`select coalesce(max(seq), 0)::int as seq from events where session_id = $1 and type in ('message_delivered','email_sent','job_failed','message_held')`, [sessionId]);
          const seq = r.rows[0]!.seq;
          if (seq > lastSeq) { lastSeq = seq; send("inbox", { seq }); } else send("ping", { seq });
        } catch (e) { send("error", { message: (e as Error).message }); }
        if (!closed) setTimeout(tick, 2000);
      };
      void tick();
      req.signal.addEventListener("abort", () => { closed = true; try { controller.close(); } catch { /* already closed */ } });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
