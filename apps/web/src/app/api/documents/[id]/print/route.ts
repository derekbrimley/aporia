import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

/** Printable page for "Download PDF" (the browser's print-to-PDF; no separate object store). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["associate", "internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  const s = await sessionForUser(u);
  if (!s || (u.role === "associate" && !s.state.documentsReleased.includes(id))) return new Response("Not found", { status: 404 });
  const doc = s.documents.get(id);
  if (!doc) return new Response("Not found", { status: 404 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${doc.title}</title><style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;line-height:1.6;color:#222}h1{font-size:24px}h2{font-size:17px;margin-top:24px;border-top:1px solid #ddd;padding-top:10px}h3{font-size:15px}.doc-clause{padding-left:24px}@media print{@page{margin:1in}}</style></head><body onload="window.print()">${doc.html}</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
