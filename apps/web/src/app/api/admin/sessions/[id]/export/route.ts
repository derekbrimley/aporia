import { EXPORT_TABLES, exportSession, sessionExportZip, type ExportTable } from "@rematter/db";
import { auditExport, exportReader } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Session export (read-only). Internal admins (cookie) or `Authorization: Bearer $EXPORT_API_TOKEN`.
 *   ?format=zip (default)  transcript.md + export.json + one CSV per table
 *   ?format=transcript     the Markdown transcript only
 *   ?format=json           everything as JSON; `&tables=messages,events` narrows the tables
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reader = await exportReader(req);
  if (reader instanceof Response) return reader;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "zip";
  if (!["zip", "json", "transcript"].includes(format)) return Response.json({ error: "format must be zip, json or transcript" }, { status: 400 });
  const tablesParam = url.searchParams.get("tables");
  const tables = tablesParam ? (tablesParam.split(",").filter((t) => (EXPORT_TABLES as readonly string[]).includes(t)) as ExportTable[]) : undefined;

  const x = await exportSession(id, { tables });
  if (!x) return Response.json({ error: "not found" }, { status: 404 });
  await auditExport(reader, "session.export", id, { format, tables: tables ?? "all" });

  const noStore = { "Cache-Control": "no-store" };
  if (format === "transcript") return new Response(x.transcript, { headers: { ...noStore, "Content-Type": "text/markdown; charset=utf-8" } });
  if (format === "json") return Response.json(x, { headers: noStore });
  const { filename, data } = sessionExportZip(x);
  return new Response(new Uint8Array(data), {
    headers: { ...noStore, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
