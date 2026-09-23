import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

export function Shell({ user, title, children }: { user: CurrentUser; title: string; children: React.ReactNode }) {
  const links: [string, string][] = user.role === "internal_admin"
    ? [["/admin", "Sessions"], ["/admin/held", "Held emails"], ["/admin/flags", "Flags"], ["/admin/ratings", "Ratings"], ["/admin/cohorts", "Cohorts and users"], ["/pd", "PD view"], ["/rater", "Rater view"]]
    : user.role === "pd_admin" ? [["/pd", "Cohort progress"], ["/admin/cohorts", "Invite associates"]] : [["/rater", "Transcripts"], ["/admin/ratings", "Rate outputs"]];
  return (
    <main className="min-h-screen" style={{ padding: "24px 32px" }}>
      <header className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-6">
          <div className="display text-[22px]">{env.productName}</div>
          <nav className="flex gap-1">{links.map(([href, label]) => <Link key={href} href={href} className="btn btn-sm btn-ghost">{label}</Link>)}</nav>
        </div>
        <form action="/api/auth/sign-out" method="post" className="flex items-center gap-3 text-sm text-ink-muted"><span>{user.name} · {user.role.replace("_", " ")}</span><button className="btn btn-sm">Sign out</button></form>
      </header>
      <h1 className="display text-[30px] font-normal m-0 mb-4">{title}</h1>
      {children}
    </main>
  );
}
