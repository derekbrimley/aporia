import { requireUser } from "@/lib/auth";
import { listFlags } from "@/lib/admin";
import { Shell } from "@/components/admin/Shell";
import { FlagTriage } from "@/components/admin/FlagTriage";

export const dynamic = "force-dynamic";

export default async function FlagsPage() {
  const u = await requireUser(["internal_admin"]);
  const flags = JSON.parse(JSON.stringify(await listFlags()));
  return <Shell user={u} title="Tester flags"><FlagTriage flags={flags} /></Shell>;
}
