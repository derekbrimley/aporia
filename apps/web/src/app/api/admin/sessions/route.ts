import { auditExport, exportReader } from "@/lib/auth";
import { listSessions } from "@/lib/admin";
/** Internal admins, or the export token (so a script can find a session id by tester name). */
export async function GET(req: Request) {
  const reader = await exportReader(req);
  if (reader instanceof Response) return reader;
  if (!reader.user) await auditExport(reader, "session.list");
  return Response.json({ sessions: await listSessions() });
}
