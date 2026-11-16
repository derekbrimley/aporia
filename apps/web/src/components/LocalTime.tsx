"use client";
import { useEffect, useState } from "react";

/**
 * A timestamp in the viewer's own time zone, with the zone named ("Nov 15, 2026, 6:57 PM MST").
 * Server-rendered times would use the server's zone (UTC on Railway), so the server renders UTC,
 * labeled as such, and the browser swaps in local time once it runs.
 */
export function LocalTime({ iso, dateOnly = false, empty = "—" }: { iso: string | Date | null | undefined; dateOnly?: boolean; empty?: string }) {
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  if (!iso) return <>{empty}</>;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <>{empty}</>;
  const zone = tz ?? "UTC";
  const text = d.toLocaleString("en-US", dateOnly
    ? { timeZone: zone, month: "short", day: "numeric", year: "numeric" }
    : { timeZone: zone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  return <time dateTime={d.toISOString()} title={d.toISOString()} suppressHydrationWarning>{text}</time>;
}
