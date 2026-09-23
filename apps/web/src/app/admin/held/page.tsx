import { requireUser } from "@/lib/auth";
import { listHeld } from "@/lib/admin";
import { Shell } from "@/components/admin/Shell";
import { HeldQueue } from "@/components/admin/HeldQueue";

export const dynamic = "force-dynamic";

export default async function HeldPage() {
  const u = await requireUser(["internal_admin"]);
  const held = JSON.parse(JSON.stringify(await listHeld()));
  return <Shell user={u} title="Held emails awaiting release"><p className="text-sm text-ink-muted mb-4">The fact checker failed these after two regenerations. The associate sees a reply that has not arrived yet. Release as written, edit and release, or discard.</p><HeldQueue held={held} /></Shell>;
}
