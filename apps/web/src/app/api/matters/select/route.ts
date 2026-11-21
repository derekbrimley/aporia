import { cookies } from "next/headers";
import { apiUser, signIn } from "@/lib/auth";
import { env } from "@/lib/env";
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
  // Redirects use APP_URL, not req.url: behind Railway's proxy that is http://localhost:8080.
  if (!id || !match) return Response.redirect(`${env.appUrl}/matters`, 303);
  if (match.userId !== u.id) await signIn(match.userId, u.impersonator);
  (await cookies()).set(MATTER_COOKIE, id, {
    path: "/",
    sameSite: "lax",
    secure: env.isProd,
    maxAge: 365 * 86_400,
  });
  return Response.redirect(`${env.appUrl}/`, 303);
}
