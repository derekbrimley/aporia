import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { listMatters, type MatterCard } from "@/lib/matters";

export const dynamic = "force-dynamic";

function statusLine(m: MatterCard): string {
  if (m.status === "completed") return "Closed";
  if (m.status === "not_started" || !m.milestone) return "Not started";
  return `Milestone ${m.milestone.order} of ${m.milestoneCount}: ${m.milestone.title}`;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The associate's matters: one card per simulation they belong to. Each opens its own, separate inbox. */
export default async function MattersPage() {
  const u = await requireUser(["associate"]);
  const matters = await listMatters(u);
  if (matters.length === 0) redirect("/");
  return (
    <main className="min-h-screen flex justify-center p-6">
      <div className="w-[720px] max-w-full flex flex-col gap-6" style={{ paddingTop: 48 }}>
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="text-[12px] font-semibold tracking-[0.08em] uppercase text-ink-muted">{env.productName}</div>
            <h1 className="display text-[32px] leading-[1.15] font-normal m-0">Your matters</h1>
          </div>
          <form action="/api/auth/sign-out" method="post"><button className="btn btn-ghost btn-sm text-ink-muted">Sign out, {u.firstName}</button></form>
        </div>
        <p className="m-0 text-[15px] text-ink-muted">Each matter is its own deal with its own inbox. Your progress in each is saved separately.</p>
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {matters.map((m) => (
            <li key={m.cohortId} className="card flex items-start justify-between gap-5" style={{ padding: "22px 24px" }}>
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="text-[12px] font-semibold tracking-[0.08em] uppercase text-ink-muted">{m.label}</div>
                <h2 className="display text-[22px] leading-[1.2] font-normal m-0">{m.title}</h2>
                <p className="m-0 text-[14.5px] leading-[1.5] text-ink-muted">{m.summary}</p>
                <div className="text-[13px] text-ink-muted">{statusLine(m)}{m.lastActivityAt ? ` · Last worked ${fmt(m.lastActivityAt)}` : ""}</div>
              </div>
              <a className="btn btn-primary shrink-0" href={`/api/matters/select?c=${m.cohortId}`}>{m.status === "not_started" ? "Start" : "Open"}</a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
