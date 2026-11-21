import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "@rematter/scenario";
import { migrate } from "../migrate.js";
import { getDb, getPool, closeDb, databaseUrl } from "../client.js";
import { seedDevData } from "../seed.js";
import { appendEvent } from "../runtime.js";
import { EXPORT_TABLES, exportSession, sessionExportZip, toCsv, zip } from "../export.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));

describe("toCsv / zip", () => {
  it("quotes commas, quotes and newlines and serializes json and dates", () => {
    const csv = toCsv([{ a: 'say "hi", ok', b: { x: [1] }, c: null, d: new Date("2026-01-02T03:04:05Z"), e: "line1\nline2" }]);
    expect(csv).toBe('a,b,c,d,e\n"say ""hi"", ok","{""x"":[1]}",,2026-01-02T03:04:05.000Z,"line1\nline2"\n');
    expect(toCsv([])).toBe("");
  });

  it("writes a zip that unzip can read back", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const body = "héllo ".repeat(1000);
    writeFileSync(join(dir, "t.zip"), zip([{ name: "d/a.txt", data: body }, { name: "d/b.csv", data: "" }]));
    execFileSync("unzip", ["-q", join(dir, "t.zip"), "-d", join(dir, "out")]);
    expect(readFileSync(join(dir, "out/d/a.txt"), "utf8")).toBe(body);
    expect(readFileSync(join(dir, "out/d/b.csv"), "utf8")).toBe("");
  });
});

describe("exportSession", () => {
  let sessionId: string;
  beforeAll(async () => {
    await migrate(databaseUrl());
    const seeded = await seedDevData(getDb(), pkg, { slug: `export-${Date.now()}`, testMode: true });
    sessionId = seeded.sessionId;
    await appendEvent(sessionId, { type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } }, "api", pkg);
    await appendEvent(sessionId, {
      type: "message_delivered",
      payload: { messageId: randomUUID(), threadId: randomUUID(), threadKey: "orientation", beatId: "B-M1-welcome", kind: "beat", from: "senior_associate", to: ["associate"], cc: [], subject: "Start here", body: "Welcome, the term sheet is attached.", attachments: [] },
    }, "worker", pkg, { idempotencyKey: `${sessionId}:deliver:beat:B-M1-welcome` });
    const m = (await getPool().query(`select id, org_id from messages where session_id = $1`, [sessionId])).rows[0];
    const u = (await getPool().query(`select user_id from sessions where id = $1`, [sessionId])).rows[0];
    await getPool().query(`insert into flags (org_id, session_id, user_id, target_type, target_id, note) values ($1, $2, $3, 'message', $4, 'Felt abrupt')`, [m.org_id, sessionId, u.user_id, m.id]);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("returns null for an unknown session", async () => {
    expect(await exportSession(randomUUID())).toBeNull();
  });

  it("exports every table, names characters and inlines flags in the transcript", async () => {
    const x = (await exportSession(sessionId))!;
    expect(Object.keys(x.tables).sort()).toEqual([...EXPORT_TABLES].sort());
    expect(x.tables.sessions).toHaveLength(1);
    expect(x.tables.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(x.tables.messages).toHaveLength(1);
    const senior = pkg.characters.find((c) => c.id === "senior_associate")!;
    expect(x.transcript).toContain(`· ${senior.name} (${senior.role_label})`);
    expect(x.transcript).toContain("Welcome, the term sheet is attached.");
    expect(x.transcript).toContain("**Tester flag** (message, open");
    expect(x.transcript).toContain("Felt abrupt");
  });

  it("narrows tables on request and builds the zip", async () => {
    const x = (await exportSession(sessionId, { tables: ["messages"] }))!;
    expect(Object.keys(x.tables)).toEqual(["messages"]);
    expect(x.transcript).toContain("Felt abrupt");
    const full = (await exportSession(sessionId))!;
    const { filename, data } = sessionExportZip(full);
    expect(filename).toMatch(/^session-[0-9a-f]{8}-\d{12}\.zip$/);
    expect(data.subarray(0, 4).toString("hex")).toBe("504b0304");
  });
});
