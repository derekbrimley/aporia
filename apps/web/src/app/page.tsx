import { requireUser } from "@/lib/auth";
import { InboxApp } from "@/components/inbox/InboxApp";

export default async function Home() {
  const u = await requireUser(["associate"]);
  return <InboxApp userName={u.firstName} />;
}
