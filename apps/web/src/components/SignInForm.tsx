"use client";
import { useState } from "react";

export function SignInForm({ workos }: { workos: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ sent?: boolean; devLink?: string; busy?: boolean }>({});
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    const r = await fetch("/api/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const j = (await r.json()) as { devLink?: string };
    setState({ sent: true, devLink: j.devLink });
  }
  if (state.sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[15px]">If that address is on a cohort, a sign-in link is on its way. It is valid for 20 minutes.</p>
        {state.devLink && <a className="btn btn-primary" href={state.devLink}>Open the sign-in link (local dev)</a>}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-semibold">Work email</label>
        <input id="email" type="email" required autoComplete="email" className="text-input" placeholder="you@firm.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary" style={{ height: 48, fontSize: 16 }} disabled={state.busy}>Send me a sign-in link</button>
      {workos && <a className="btn" href="/api/auth/workos/start">Sign in with your firm's SSO</a>}
    </form>
  );
}
