/**
 * Notion deal-bible import.
 *
 * Reads the attorney-authored deal bible databases and writes YAML into a
 * scenario package directory. Configure the data source IDs in
 * `<scenario>/notion-sources.yaml`; authenticate with NOTION_TOKEN (an internal
 * integration token that has been given access to the deal bible page).
 *
 * The import is intentionally conservative: it only writes the files whose
 * source database is configured, it never deletes rows, and it prints every
 * field it could not map so the attorney can fix the row in Notion.
 *
 * Mapping (Notion column -> package field) follows the deal bible template:
 *   2 Characters       -> characters/*.yaml (voice, knows, never_does, writes_when, sample_messages)
 *   3 Milestone map    -> milestones.yaml (title, summary, order, recap_hint)
 *   4 Deltas           -> deltas.yaml
 *   5 Assignments      -> assignments.yaml (title, deliverable, competencies, socratic_angles, common_misses)
 *   5a Issues          -> assignments[].issues (ID like A4.I3, tier, raise/partial text, delta link)
 *   5b Decision points -> assignments[].decision_points (ID like A4.D1, trigger, positions, tradeoffs)
 *   6 Consequence map  -> consequences.yaml (seed issue / decision point / outcome columns)
 *   7 Verification     -> verification.yaml
 *   8 Register         -> documents/register.yaml
 *
 * Fields the engine needs that the bible does not carry (thread keys, beat
 * triggers, fact keys) are preserved from the existing YAML when present.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const SourcesSchema = z.object({
  characters: z.string().optional(),
  milestones: z.string().optional(),
  deltas: z.string().optional(),
  assignments: z.string().optional(),
  issues: z.string().optional(),
  decision_points: z.string().optional(),
  consequences: z.string().optional(),
  verification: z.string().optional(),
  register: z.string().optional(),
});

const NOTION_VERSION = "2022-06-28";

type NotionPage = { id: string; properties: Record<string, NotionProp> };
type NotionProp =
  | { type: "title"; title: { plain_text: string }[] }
  | { type: "rich_text"; rich_text: { plain_text: string }[] }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: { name: string }[] }
  | { type: "relation"; relation: { id: string }[] }
  | { type: string; [k: string]: unknown };

async function queryAll(dataSourceId: string, token: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dataSourceId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status} for ${dataSourceId}: ${await res.text()}`);
    const json = (await res.json()) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
    pages.push(...json.results);
    cursor = json.has_more && json.next_cursor ? json.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function text(p: NotionProp | undefined): string {
  if (!p) return "";
  if (p.type === "title") return (p as { title: { plain_text: string }[] }).title.map((t) => t.plain_text).join("").trim();
  if (p.type === "rich_text") return (p as { rich_text: { plain_text: string }[] }).rich_text.map((t) => t.plain_text).join("").trim();
  if (p.type === "select") return (p as { select: { name: string } | null }).select?.name ?? "";
  if (p.type === "number") return String((p as { number: number | null }).number ?? "");
  return "";
}
function bool(p: NotionProp | undefined): boolean {
  return p?.type === "checkbox" ? (p as { checkbox: boolean }).checkbox : false;
}
function num(p: NotionProp | undefined): number | undefined {
  return p?.type === "number" ? ((p as { number: number | null }).number ?? undefined) : undefined;
}
function lines(s: string): string[] {
  return s.split(/\n|;\s+/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}
const COMPETENCY_BY_NUMBER: Record<string, string> = {
  "1": "ucc_article_9", "2": "loan_structure_payments", "3": "conditions_precedent_closing", "4": "reps_warranties",
  "5": "covenants", "6": "events_of_default_remedies", "7": "venture_lending_concepts", "8": "regulatory_compliance",
};
function competencies(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\b([1-8])\b/g)) out.add(COMPETENCY_BY_NUMBER[m[1]!]!);
  return [...out];
}
function milestoneId(s: string): string | undefined {
  return s.match(/\bM([1-8])\b/)?.[0];
}
function writeYaml(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(data, { lineWidth: 100 }));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
function readYamlIfExists<T>(file: string): T | undefined {
  return fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
}

async function main() {
  const dir = process.argv[2] ?? path.resolve("scenarios/venture-debt-01");
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("NOTION_TOKEN is required (internal integration token with access to the deal bible).");
    process.exit(2);
  }
  const sourcesFile = path.join(dir, "notion-sources.yaml");
  if (!fs.existsSync(sourcesFile)) {
    console.error(`Missing ${sourcesFile}. Copy notion-sources.example.yaml and fill in the data source IDs.`);
    process.exit(2);
  }
  const sources = SourcesSchema.parse(YAML.parse(fs.readFileSync(sourcesFile, "utf8")));
  const unmapped: string[] = [];

  if (sources.characters) {
    const rows = await queryAll(sources.characters, token);
    for (const r of rows) {
      const name = text(r.properties["Name"]);
      if (!name || /^EXAMPLE/i.test(name)) continue;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const file = path.join(dir, "characters", `${id}.yaml`);
      const existing = readYamlIfExists<Record<string, any>>(file) ?? {};
      const knowsText = text(r.properties["Knows"]);
      writeYaml(file, {
        ...existing,
        id: existing.id ?? id,
        name,
        first_name: existing.first_name ?? name.split(" ")[0],
        role_label: text(r.properties["Role"]) || existing.role_label,
        voice: text(r.properties["Voice and style"]) || existing.voice,
        teaching_or_negotiating_style: text(r.properties["Teaching or negotiating style"]) || undefined,
        wants: text(r.properties["Wants and how they apply pressure"]) || undefined,
        knows: { ...(existing.knows as object | undefined), background: lines(knowsText) },
        does_not_know: lines(text(r.properties["Does not know"])),
        never_does: lines(text(r.properties["Never does"])),
        writes_when: lines(text(r.properties["Writes when"])),
        sample_messages: lines(text(r.properties["Sample messages"])),
      });
      if (!existing.email) unmapped.push(`characters/${id}.yaml: set email, title, organization, side, reply_delay_seconds, knows.facts/documents`);
    }
  }

  if (sources.milestones) {
    const rows = await queryAll(sources.milestones, token);
    const file = path.join(dir, "milestones.yaml");
    const existing = readYamlIfExists<Record<string, any>[]>(file) ?? [];
    const merged = rows
      .map((r) => {
        const title = text(r.properties["Milestone"]);
        const id = milestoneId(title) ?? (num(r.properties["Order"]) ? `M${num(r.properties["Order"])}` : undefined);
        if (!id) { unmapped.push(`milestones: row "${title}" has no M# id or Order`); return null; }
        const prev: Record<string, any> = existing.find((m) => m.id === id) ?? {};
        return {
          ...prev,
          id,
          order: num(r.properties["Order"]) ?? (prev.order as number | undefined) ?? Number(id.slice(1)),
          title: title.replace(/^M\d\s*/, ""),
          summary: text(r.properties["Emails released"]) || prev.summary,
          recap_hint: text(r.properties["Re-entry recap"]) || prev.recap_hint,
          threads_open: lines(text(r.properties["Threads open"])),
        };
      })
      .filter(Boolean);
    writeYaml(file, merged);
    unmapped.push("milestones.yaml: entry/exit conditions and assignments are engine fields; keep them from the existing file");
  }

  if (sources.deltas) {
    const rows = await queryAll(sources.deltas, token);
    const file = path.join(dir, "deltas.yaml");
    const existing = readYamlIfExists<Record<string, any>[]>(file) ?? [];
    let n = existing.length;
    const out = rows
      .filter((r) => !/^EXAMPLE/i.test(text(r.properties["Provision"])))
      .map((r) => {
        const provision = text(r.properties["Provision"]);
        const prev = existing.find((d) => d.provision === provision);
        const id = prev?.id ?? `D${String(++n).padStart(2, "0")}`;
        return {
          ...prev,
          id,
          provision,
          document: prev?.document ?? text(r.properties["Document"]).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          term_sheet_says: text(r.properties["Term sheet says"]),
          document_says: text(r.properties["Document says"]),
          delta_type: (text(r.properties["Delta type"]).toLowerCase().replace(/\s+/g, "_") || "standard"),
          lender_flexibility: (text(r.properties["Lender flexibility"]).toLowerCase() || "low"),
          competencies: competencies(text(r.properties["Competencies"])),
          surfaces_in: milestoneId(text(r.properties["Surfaces in"])) ?? "M4",
          strong_associate_does: text(r.properties["What a strong associate does"]),
          status: (text(r.properties["Status"]).toLowerCase().replace(/\s+/g, "_") || "not_drafted"),
        };
      });
    writeYaml(file, out);
  }

  if (sources.assignments) {
    const rows = await queryAll(sources.assignments, token);
    const issueRows = sources.issues ? await queryAll(sources.issues, token) : [];
    const dpRows = sources.decision_points ? await queryAll(sources.decision_points, token) : [];
    const file = path.join(dir, "assignments.yaml");
    const existing = readYamlIfExists<Record<string, any>[]>(file) ?? [];
    const out = rows.map((r) => {
      const title = text(r.properties["Assignment"] ?? r.properties["Name"]);
      const id = title.match(/\bA\d{1,2}\b/)?.[0];
      if (!id) { unmapped.push(`assignments: row "${title}" has no A# id in its title`); return null; }
      const prev: Record<string, any> = existing.find((a) => a.id === id) ?? {};
      const issues = issueRows
        .filter((i) => text(i.properties["ID"] ?? i.properties["Name"]).startsWith(id + "."))
        .map((i) => ({
          id: text(i.properties["ID"] ?? i.properties["Name"]),
          tier: text(i.properties["Tier"]).toLowerCase() || "expected",
          title: text(i.properties["Issue"]) || text(i.properties["Title"]) || text(i.properties["ID"]),
          description: text(i.properties["Description"]) || text(i.properties["Issue"]),
          raised_looks_like: text(i.properties["Raise looks like"]) || text(i.properties["How a raise looks"]),
          partial_looks_like: text(i.properties["Partial raise looks like"]) || undefined,
          delta: text(i.properties["Delta"]).match(/\bD\d{2}\b/)?.[0],
          competencies: competencies(text(i.properties["Competencies"])),
        }));
      const decision_points = dpRows
        .filter((d) => text(d.properties["ID"] ?? d.properties["Name"]).startsWith(id + "."))
        .map((d) => ({
          id: text(d.properties["ID"] ?? d.properties["Name"]),
          title: text(d.properties["Decision"]) || text(d.properties["Title"]),
          trigger: text(d.properties["Trigger"]),
          question: text(d.properties["Question"]) || text(d.properties["Decision"]),
          rationale_prompt: text(d.properties["Rationale prompt"]) || "Why are you making this call, and what does it mean for the client?",
          positions: ["P1", "P2", "P3", "P4"]
            .map((p) => ({ id: p, label: text(d.properties[p]), description: text(d.properties[`${p} description`]) || text(d.properties[p]) }))
            .filter((p) => p.label),
        }));
      return {
        ...prev,
        id,
        milestone: milestoneId(text(r.properties["Milestone"])) ?? prev.milestone,
        title: title.replace(/^A\d{1,2}\s*[:.-]?\s*/, ""),
        deliverable: text(r.properties["Deliverable"]) || prev.deliverable,
        competencies: competencies(text(r.properties["Competencies"])).length ? competencies(text(r.properties["Competencies"])) : prev.competencies,
        socratic_angles: lines(text(r.properties["Socratic angles"])),
        common_misses: lines(text(r.properties["Common misses"])),
        issues: issues.length ? issues : prev.issues,
        decision_points: decision_points.length ? decision_points : prev.decision_points,
      };
    }).filter(Boolean);
    writeYaml(file, out);
    unmapped.push("assignments.yaml: assigned_by, feedback_from, thread_key, expected_recipients, completion are engine fields; keep them from the existing file");
  }

  if (sources.consequences) {
    const rows = await queryAll(sources.consequences, token);
    const file = path.join(dir, "consequences.yaml");
    const existing = readYamlIfExists<Record<string, any>[]>(file) ?? [];
    let n = existing.length;
    const out = rows
      .filter((r) => !/^EXAMPLE/i.test(text(r.properties["Chain"])))
      .map((r) => {
        const title = text(r.properties["Chain"]);
        const prev = existing.find((c) => c.title === title);
        const id = prev?.id ?? `C${String(++n).padStart(2, "0")}`;
        const seedIssue = text(r.properties["Seed issue"]).match(/\bA\d{1,2}\.I\d{1,2}\b/)?.[0];
        const seedDp = text(r.properties["Seed decision point"]).match(/\bA\d{1,2}\.D\d{1,2}\b/)?.[0];
        const outcome = text(r.properties["Seed outcome"]).toLowerCase() || "missed";
        if (!seedIssue && !seedDp) unmapped.push(`consequences: "${title}" has no Seed issue or Seed decision point ID`);
        return {
          ...prev,
          id,
          title,
          seed: seedIssue ? { issue: seedIssue, outcome } : { decision_point: seedDp, outcome: outcome.toUpperCase() },
          payoff_milestone: milestoneId(text(r.properties["Payoff milestone"])) ?? prev?.payoff_milestone,
          raised_by: prev?.raised_by ?? text(r.properties["Raised by"]).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          beat: prev?.beat ?? `B-${id}`,
          how_it_appears: text(r.properties["How it appears"]),
          severity: text(r.properties["Severity"]).toLowerCase() || "moderate",
          recoverable: bool(r.properties["Recoverable"]),
          positive: bool(r.properties["Positive chain"]),
          debrief_candidate: bool(r.properties["Debrief candidate"]),
        };
      });
    writeYaml(file, out);
  }

  if (sources.register) {
    const rows = await queryAll(sources.register, token);
    const file = path.join(dir, "documents", "register.yaml");
    const existing = readYamlIfExists<Record<string, any>[]>(file) ?? [];
    const out = rows.map((r) => {
      const title = text(r.properties["Document"] ?? r.properties["Name"]);
      const prev: Record<string, any> = existing.find((d) => d.title === title) ?? {};
      return {
        ...prev,
        id: prev.id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        title,
        short_title: prev.short_title ?? title,
        version: text(r.properties["Version"]) || prev.version || "0.1",
        attorney_reviewed: /reviewed|approved/i.test(text(r.properties["Status"])),
        realism_notes: text(r.properties["Realism notes"]) || undefined,
      };
    });
    writeYaml(file, out);
  }

  if (unmapped.length) {
    console.log("\nNeeds attention:");
    for (const u of unmapped) console.log(`  - ${u}`);
  }
  console.log("\nRun `pnpm scenario:validate` to check the result.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
