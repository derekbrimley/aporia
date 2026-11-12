import { cookies } from "next/headers";
import { apiUser } from "@/lib/auth";
import { MATTER_COOKIE, memberships } from "@/lib/matters";

/** Opens a matter: remembers it (a year) and goes to the inbox. Only the user's own cohorts can be chosen. */
export async function GET(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const url = new URL(req.url);
  const id = url.searchParams.get("c");
  const all = await memberships(u);
  if (!id || !all.some((c) => c.id === id)) return Response.redirect(new URL("/matters", url), 303);
  (await cookies()).set(MATTER_COOKIE, id, {
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: 365 * 86_400,
  });
  return Response.redirect(new URL("/", url), 303);
}
