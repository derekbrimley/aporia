"use client";
import { useEffect, useRef } from "react";

/**
 * Submits the sign-in confirm form as soon as the page runs in a real browser, so the person never
 * has to click. Link scanners that only fetch the page don't run this, so they still can't spend the
 * token. The button stays as a fallback when scripts are off or the submit is blocked.
 */
export function AutoContinue({ token, label }: { token: string; label: string }) {
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  useEffect(() => {
    // Once only: a second POST of the same token would find it spent (and Strict Mode runs effects twice).
    if (sent.current) return;
    sent.current = true;
    form.current?.requestSubmit();
  }, []);
  return (
    <form ref={form} method="post" action="/api/auth/callback" className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <p className="m-0 text-[15px] text-ink-muted">Signing you in…</p>
      <button type="submit" className="btn btn-primary" style={{ height: 48, fontSize: 16 }}>
        {label}
      </button>
    </form>
  );
}
