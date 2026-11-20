import { crc32, deflateRawSync } from "node:zlib";
import { getScenario } from "@rematter/scenario";
import { getPool } from "./client.js";

/**
 * Session export: every row a session owns, for offline review (admin download, export API, CLI).
 * Read-only. Mirrors the tables the old `railway run … psql \copy` script pulled.
 */
export const EXPORT_TABLES = [
  "sessions",
  "session_snapshots",
  "events",
  "messages",
  "threads",
  "message_reads",
  "decisions",
  "issue_status",
  "consequences",
  "generations",
  "held_emails",
  "flags",
  "ratings",
  "drafts",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

const ORDER: Partial<Record<ExportTable, string>> = {
  events: "seq",
  messages: "delivered_at, seq",
  threads: "last_message_at",
  generations: "created_at",
  held_emails: "created_at",
  flags: "created_at",
  ratings: "created_at",
};

export interface SessionExport {
  sessionId: string;
  exportedAt: string;
  tester: { name: string; email: string } | null;
  scenario: { id: string; version: string };
  /** Character id -> display name, for reading `from_participant` and friends. */
  participants: Record<string, string>;
  tables: Record<ExportTable, Record<string, unknown>[]>;
  /** Readable email-by-email transcript in Markdown. */
  transcript: string;
}

export async function exportSession(sessionId: string, opts: { tables?: ExportTable[] } = {}): Promise<SessionExport | null> {
  const pool = getPool();
  const head = (
    await pool.query<{ scenario_id: string; scenario_version: string; time_zone: string | null; name: string; email: string }>(
      `select s.scenario_id, s.scenario_version, s.time_zone, u.name, u.email from sessions s join users u on u.id = s.user_id where s.id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!head) return null;

  const wanted = new Set<ExportTable>(opts.tables ?? EXPORT_TABLES);
  // The transcript needs these whatever was asked for.
  for (const t of ["sessions", "messages", "threads", "flags", "held_emails"] as const) wanted.add(t);
  const tables = {} as Record<ExportTable, Record<string, unknown>[]>;
  await Promise.all(
    EXPORT_TABLES.filter((t) => wanted.has(t)).map(async (t) => {
      const where = t === "sessions" ? "id = $1" : "session_id = $1";
      const order = ORDER[t] ? ` order by ${ORDER[t]}` : "";
      tables[t] = (await pool.query(`select * from ${t} where ${where}${order}`, [sessionId])).rows;
    }),
  );

  const participants: Record<string, string> = { associate: `${head.name} (associate)` };
  try {
    const { pkg } = getScenario(head.scenario_id, head.scenario_version);
    for (const c of pkg.characters) participants[c.id] = `${c.name} (${c.role_label})`;
  } catch {
    // Unknown scenario version: fall back to raw ids.
  }

  const out: SessionExport = {
    sessionId,
    exportedAt: new Date().toISOString(),
    tester: { name: head.name, email: head.email },
    scenario: { id: head.scenario_id, version: head.scenario_version },
    participants,
    tables,
    transcript: "",
  };
  out.transcript = renderTranscript(out, head.time_zone);
  if (opts.tables) for (const t of EXPORT_TABLES) if (!opts.tables.includes(t)) delete (tables as Partial<typeof tables>)[t];
  return out;
}

// ---------------------------------------------------------------- transcript

function fmtTime(v: unknown, tz: string | null): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz ?? "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function renderTranscript(x: Pick<SessionExport, "sessionId" | "tester" | "scenario" | "participants" | "tables">, tz: string | null): string {
  const name = (id: string) => x.participants[id] ?? id;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((p) => name(String(p))).join(", ") : "");
  const s = x.tables.sessions[0] ?? {};
  const threads = new Map(x.tables.threads.map((t) => [String(t.id), t]));
  const flagsByTarget = new Map<string, Record<string, unknown>[]>();
  for (const f of x.tables.flags.filter((f) => f.target_type === "message")) {
    const k = String(f.target_id);
    flagsByTarget.set(k, [...(flagsByTarget.get(k) ?? []), f]);
  }

  const L: string[] = [];
  L.push(`# Session ${x.sessionId}`, "");
  L.push(`- Tester: ${x.tester ? `${x.tester.name} <${x.tester.email}>` : "unknown"}`);
  L.push(`- Scenario: ${x.scenario.id} v${x.scenario.version}, engine ${s.engine_version ?? "?"}`);
  L.push(`- Status: ${s.status ?? "?"}, milestone ${s.current_milestone ?? "none"}`);
  L.push(`- Started: ${fmtTime(s.started_at, tz)} · Last activity: ${fmtTime(s.last_activity_at, tz)}${s.completed_at ? ` · Completed: ${fmtTime(s.completed_at, tz)}` : ""}`);
  L.push(`- Time zone: ${tz ?? "UTC"} · Active time: ${Math.round(Number(s.active_seconds ?? 0) / 60)} min`);
  L.push(`- ${x.tables.messages.length} emails in ${x.tables.threads.length} threads · ${x.tables.flags.length} tester flags · ${x.tables.held_emails.length} held emails`);
  L.push("", "## Emails, in delivery order", "");

  for (const m of x.tables.messages) {
    const t = threads.get(String(m.thread_id));
    const tags = [m.kind, m.intent && `intent ${m.intent}`, m.beat_id && `beat ${m.beat_id}`, m.assignment_id && `assignment ${m.assignment_id}`].filter(Boolean).join(" · ");
    L.push(`### ${fmtTime(m.delivered_at, tz)} · ${name(String(m.from_participant))}`);
    L.push(`Thread: ${t?.subject ?? m.subject}${t?.hidden ? " (hidden)" : ""} · #${m.seq}`);
    L.push(`To: ${names(m.to_participants)}${Array.isArray(m.cc_participants) && m.cc_participants.length ? ` · Cc: ${names(m.cc_participants)}` : ""}`);
    if (m.subject !== t?.subject) L.push(`Subject: ${m.subject}`);
    if (Array.isArray(m.attachments) && m.attachments.length) L.push(`Attachments: ${m.attachments.join(", ")}`);
    L.push(`(${tags}) · id ${m.id}`, "");
    L.push(String(m.body).trim(), "");
    for (const f of flagsByTarget.get(String(m.id)) ?? []) {
      L.push(`> **Tester flag** (${f.target_type}, ${f.status}, ${fmtTime(f.created_at, tz)}): ${f.note}`, "");
    }
    L.push("---", "");
  }

  const otherFlags = x.tables.flags.filter((f) => f.target_type !== "message");
  if (otherFlags.length) {
    L.push("## Document and thread flags", "");
    for (const f of otherFlags) {
      const target = f.target_type === "thread" ? `thread "${threads.get(String(f.target_id))?.subject ?? f.target_id}"` : `document ${f.target_id}`;
      L.push(`- ${fmtTime(f.created_at, tz)} · ${target} (${f.status}): ${f.note}`);
    }
    L.push("");
  }
  if (x.tables.held_emails.length) {
    L.push("## Held emails (fact checker)", "");
    for (const h of x.tables.held_emails) {
      const p = (h.proposed_delivery ?? {}) as { from?: string; subject?: string; body?: string };
      L.push(`### ${fmtTime(h.created_at, tz)} · ${h.status} · ${name(String(p.from ?? "?"))}: ${p.subject ?? ""}`);
      L.push(`Violations: ${JSON.stringify(h.violations)}`, "", String(p.body ?? "").trim(), "", "---", "");
    }
  }
  return L.join("\n");
}

// ---------------------------------------------------------------- CSV + zip

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** Minimal deflate zip writer (no dependency). Entries are UTF-8 text files. */
export function zip(files: { name: string; data: string | Buffer }[], date = new Date()): Buffer {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : f.data;
    const comp = deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** The download: transcript.md, export.json and one CSV per table, under a `session-<id8>/` folder. */
export function sessionExportZip(x: SessionExport): { filename: string; data: Buffer } {
  const dir = `session-${x.sessionId.slice(0, 8)}-${x.exportedAt.slice(0, 16).replace(/[-:T]/g, "")}`;
  const files = [
    { name: `${dir}/transcript.md`, data: x.transcript },
    { name: `${dir}/export.json`, data: JSON.stringify(x, null, 2) },
    ...EXPORT_TABLES.filter((t) => x.tables[t]).map((t) => ({ name: `${dir}/${t}.csv`, data: toCsv(x.tables[t]) })),
  ];
  return { filename: `${dir}.zip`, data: zip(files) };
}
