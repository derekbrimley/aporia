import { redirect } from "next/navigation";
import { getCurrentUser, homeFor, workosEnabled } from "@/lib/auth";
import { env } from "@/lib/env";
import { SignInForm } from "@/components/SignInForm";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const u = await getCurrentUser();
  if (u) redirect(homeFor(u.role));
  const { error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-[440px] max-w-full flex flex-col gap-7" style={{ padding: "44px 40px" }}>
        <div className="flex flex-col gap-2">
          <h1 className="display text-[32px] leading-[1.15] font-normal m-0">{env.productName}</h1>
          <p className="m-0 text-[15.5px] leading-[1.55] text-ink-muted">A simulated venture debt financing for junior transactional associates.</p>
        </div>
        {error && <p className="m-0 text-sm text-plum-700" role="alert">{error === "expired" ? "That link has expired or was already used. Request a new one." : error === "not_invited" ? "That account has not been invited to a cohort." : "Sign-in could not be completed. Try again."}</p>}
        <SignInForm workos={workosEnabled()} />
        <p className="m-0 text-[13.5px] leading-[1.5] text-ink-muted">Your progress is saved to your account, so you can stop and pick up where you left off.</p>
      </div>
    </main>
  );
}
