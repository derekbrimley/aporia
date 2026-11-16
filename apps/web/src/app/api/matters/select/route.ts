import { cookies } from "next/headers";
import { apiUser, signIn } from "@/lib/auth";
import { MATTER_COOKIE, allMatters } from "@/lib/matters";

/**
 * Opens a matter: remembers it (a year) and goes to the inbox. Only the person's own matters can be
 * chosen. A matter in another firm belongs to their account there, so this switches to that account.
 */
export async function GET(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const url = new URL(req.url);
  const id = url.searchParams.get("c");
  const match = id ? (await allMatters(u)).find((m) => m.cohort.id === id) : undefined;
  if (!id || !match) return Response.redirect(new URL("/matters", url), 303);
  if (match.userId !== u.id) await signIn(match.userId);
  (await cookies()).set(MATTER_COOKIE, id, {
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: 365 * 86_400,
  });
  return Response.redirect(new URL("/", url), 303);
}
