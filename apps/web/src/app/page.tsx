import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { activeMatter } from "@/lib/matters";
import { InboxApp } from "@/components/inbox/InboxApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await requireUser(["associate"]);
  // In more than one matter and none remembered: choose first.
  const { cohort, all } = await activeMatter(u);
  if (!cohort && all.length > 1) redirect("/matters");
  return <InboxApp userName={u.firstName} matterId={cohort?.id ?? null} />;
}
