import { requireUser, audit } from "@/lib/auth";
import { sessionDetail } from "@/lib/admin";
import { Shell } from "@/components/admin/Shell";
import { SessionViewer } from "@/components/admin/SessionViewer";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(["internal_admin"]);
  const { id } = await params;
  const d = await sessionDetail(id);
  if (!d) return <Shell user={u} title="Session not found"><p>No session with that id.</p></Shell>;
  await audit(u, "session.view", id);
  return (
    <Shell user={u} title={`Session ${id.slice(0, 8)}`}>
      <SessionViewer id={id} detail={JSON.parse(JSON.stringify(d))} />
    </Shell>
  );
}
