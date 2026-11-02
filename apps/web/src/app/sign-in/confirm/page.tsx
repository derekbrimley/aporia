import { env } from "@/lib/env";

export const metadata = { robots: { index: false, follow: false } };

/**
 * The magic link lands here and signs in only on a POST. Mail scanners (Outlook Safe Links,
 * Mimecast, Proofpoint) fetch every link in an email before the person clicks it; when that GET
 * spent the one-time token, the person's own click found it already used.
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div
        className="card w-[440px] max-w-full flex flex-col gap-7"
        style={{ padding: "44px 40px" }}
      >
        <h1 className="display text-[32px] leading-[1.15] font-normal m-0">{env.productName}</h1>
        {token ? (
          <form method="post" action="/api/auth/callback" className="flex flex-col gap-5">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="btn btn-primary" style={{ height: 48, fontSize: 16 }}>
              Continue to {env.productName}
            </button>
          </form>
        ) : (
          <p className="m-0 text-sm text-plum-700" role="alert">
            That sign-in link is incomplete. <a href="/sign-in">Request a new one.</a>
          </p>
        )}
      </div>
    </main>
  );
}
