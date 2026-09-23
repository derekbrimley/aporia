import { requireUser } from "@/lib/auth";
import { ratingSample } from "@/lib/admin";
import { agreementKappa } from "@aporia/evals";
import { Shell } from "@/components/admin/Shell";
import { RatingScreen } from "@/components/admin/RatingScreen";

export const dynamic = "force-dynamic";

export default async function RatingsPage() {
  const u = await requireUser(["internal_admin", "internal_rater"]);
  const [sample, kappa] = await Promise.all([ratingSample(20), agreementKappa()]);
  return (
    <Shell user={u} title="Rate sampled outputs">
      <p className="text-sm text-ink-muted mb-4">Four dimensions, 1 to 5, plus whether you would let it reach a first-year unchanged. Agreement with the LLM judge so far: {Number.isNaN(kappa.kappa) ? "no overlapping ratings yet" : `Cohen's kappa ${kappa.kappa.toFixed(2)} over ${kappa.n} items`} (release gating needs 0.6 or higher).</p>
      <RatingScreen sample={JSON.parse(JSON.stringify(sample))} />
    </Shell>
  );
}
