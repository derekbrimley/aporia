import { getCurrentUser } from "@/lib/auth";

/**
 * Shown on every page while an admin is viewing the app as a tester. Fixed to the bottom so it
 * doesn't change the inbox's full-height layout.
 */
export async function ViewAsBanner() {
  const u = await getCurrentUser();
  if (!u?.impersonator) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-4 z-50 flex items-center gap-3 rounded-full bg-plum-700 text-cream-text text-[13.5px] shadow-card"
      style={{ padding: "8px 8px 8px 18px", maxWidth: "calc(100vw - 32px)" }}
    >
      <span className="truncate">
        Viewing as <b>{u.name}</b> ({u.email}). Read-only: nothing you do here is saved or sent.
      </span>
      <form action="/api/auth/view-as/stop" method="post" className="shrink-0">
        <button className="btn btn-sm">Back to admin</button>
      </form>
    </div>
  );
}
