import { createMagicLink } from "@/lib/auth";

export async function POST(req: Request) {
  const { email } = (await req.json()) as { email?: string };
  if (!email) return Response.json({ error: "email required" }, { status: 400 });
  const r = await createMagicLink(email);
  // Same response whether or not the address is invited, so the form does not reveal membership.
  return Response.json({ ok: true, devLink: r && r.delivered === "log" && process.env.NODE_ENV !== "production" ? r.url : undefined });
}
