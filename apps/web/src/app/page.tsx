import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { activeMatter } from "@/lib/matters";
import { InboxApp } from "@/components/inbox/InboxApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await requireUser(["associate"]);
  // None remembered and more than one (or only one, in another firm): choose first.
  const { cohort, total, elsewhere } = await activeMatter(u);
  // The remembered matter is in another firm: switch to their account there.
  if (elsewhere) redirect(`/api/matters/select?c=${elsewhere}`);
  if (!cohort && total > 0) redirect("/matters");
  return <InboxApp userName={u.firstName} matterId={cohort?.id ?? null} />;
}
