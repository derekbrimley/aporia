import fs from "node:fs";
import path from "node:path";
import type { Condition, ScenarioPackage } from "./schema.js";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

/** Walks a condition tree and reports referenced ids by kind. */
export function* conditionRefs(c: Condition): Generator<{ kind: string; id: string }> {
  if ("all" in c) { for (const x of c.all) yield* conditionRefs(x); return; }
  if ("any" in c) { for (const x of c.any) yield* conditionRefs(x); return; }
  if ("not" in c) { yield* conditionRefs(c.not); return; }
  if ("milestone_complete" in c) yield { kind: "milestone", id: c.milestone_complete };
  if ("milestone_entered" in c) yield { kind: "milestone", id: c.milestone_entered };
  if ("assignment_complete" in c) yield { kind: "assignment", id: c.assignment_complete };
  if ("assignment_open" in c) yield { kind: "assignment", id: c.assignment_open };
  if ("beat_delivered" in c) yield { kind: "beat", id: c.beat_delivered };
  if ("consequence_active" in c) yield { kind: "consequence", id: c.consequence_active };
  if ("consequence_fired" in c) yield { kind: "consequence", id: c.consequence_fired };
  if ("issue_status" in c) yield { kind: "issue", id: c.issue_status.issue };
  if ("decision_taken" in c) yield { kind: "decision_point", id: c.decision_taken.decision_point };
  if ("emails_sent_in_assignment" in c) yield { kind: "assignment", id: c.emails_sent_in_assignment.assignment };
  if ("document_opened" in c) yield { kind: "document", id: c.document_opened };
}

export function crossValidate(pkg: ScenarioPackage, dir?: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (m: string) => out.push({ level: "error", message: m });
  const warn = (m: string) => out.push({ level: "warning", message: m });

  const ids = {
    milestone: new Set(pkg.milestones.map((m) => m.id)),
    assignment: new Set(pkg.assignments.map((a) => a.id)),
    issue: new Set(pkg.assignments.flatMap((a) => a.issues.map((i) => i.id))),
    decision_point: new Set(pkg.assignments.flatMap((a) => a.decision_points.map((d) => d.id))),
    consequence: new Set(pkg.consequences.map((c) => c.id)),
    beat: new Set(pkg.beats.map((b) => b.id)),
    character: new Set(pkg.characters.map((c) => c.id)),
    document: new Set(pkg.documents.map((d) => d.id)),
    delta: new Set(pkg.deltas.map((d) => d.id)),
    fact: new Set(Object.keys(pkg.facts)),
  };
  const dup = (label: string, list: string[]) => {
    const seen = new Set<string>();
    for (const x of list) { if (seen.has(x)) err(`Duplicate ${label} id ${x}`); seen.add(x); }
  };
  dup("milestone", pkg.milestones.map((m) => m.id));
  dup("assignment", pkg.assignments.map((a) => a.id));
  dup("issue", pkg.assignments.flatMap((a) => a.issues.map((i) => i.id)));
  dup("decision point", pkg.assignments.flatMap((a) => a.decision_points.map((d) => d.id)));
  dup("consequence", pkg.consequences.map((c) => c.id));
  dup("beat", pkg.beats.map((b) => b.id));
  dup("character", pkg.characters.map((c) => c.id));
  dup("document", pkg.documents.map((d) => d.id));
  dup("delta", pkg.deltas.map((d) => d.id));

  const checkRef = (kind: keyof typeof ids, id: string, where: string) => {
    if (!ids[kind].has(id)) err(`${where} references unknown ${kind} ${id}`);
  };
  const checkCond = (c: Condition, where: string) => {
    for (const r of conditionRefs(c)) checkRef(r.kind as keyof typeof ids, r.id, where);
  };

  // Milestones: contiguous order, assignments belong to them.
  const orders = [...pkg.milestones].sort((a, b) => a.order - b.order).map((m) => m.order);
  orders.forEach((o, i) => { if (o !== i + 1) err(`Milestone orders must be contiguous from 1; got ${orders.join(",")}`); });
  for (const m of pkg.milestones) {
    checkCond(m.entry, `Milestone ${m.id} entry`);
    checkCond(m.exit, `Milestone ${m.id} exit`);
    for (const a of m.assignments) {
      checkRef("assignment", a, `Milestone ${m.id}`);
      const asg = pkg.assignments.find((x) => x.id === a);
      if (asg && asg.milestone !== m.id) err(`Assignment ${a} says milestone ${asg.milestone} but is listed under ${m.id}`);
    }
    for (const b of m.possible_interruptions) checkRef("beat", b, `Milestone ${m.id} interruptions`);
  }
  for (const a of pkg.assignments) {
    checkRef("milestone", a.milestone, `Assignment ${a.id}`);
    checkRef("character", a.assigned_by, `Assignment ${a.id} assigned_by`);
    checkRef("character", a.feedback_from, `Assignment ${a.id} feedback_from`);
    for (const r of a.expected_recipients) checkRef("character", r, `Assignment ${a.id} expected_recipients`);
    for (const i of a.issues) {
      if (!i.id.startsWith(a.id + ".")) err(`Issue ${i.id} must be prefixed with its assignment id ${a.id}`);
      if (i.delta) checkRef("delta", i.delta, `Issue ${i.id}`);
    }
    for (const d of a.decision_points) {
      if (!d.id.startsWith(a.id + ".")) err(`Decision point ${d.id} must be prefixed with its assignment id ${a.id}`);
      dup(`position in ${d.id}`, d.positions.map((p) => p.id));
    }
    const listed = pkg.milestones.some((m) => m.assignments.includes(a.id));
    if (!listed) err(`Assignment ${a.id} is not listed under any milestone`);
  }
  for (const c of pkg.consequences) {
    if ("issue" in c.seed) checkRef("issue", c.seed.issue, `Consequence ${c.id} seed`);
    else {
      checkRef("decision_point", c.seed.decision_point, `Consequence ${c.id} seed`);
      const dp = pkg.assignments.flatMap((a) => a.decision_points).find((d) => d.id === (c.seed as { decision_point: string }).decision_point);
      if (dp && !dp.positions.some((p) => p.id === c.seed.outcome)) err(`Consequence ${c.id} seed outcome ${c.seed.outcome} is not a position of ${dp.id}`);
    }
    checkRef("milestone", c.payoff_milestone, `Consequence ${c.id}`);
    checkRef("character", c.raised_by, `Consequence ${c.id}`);
    checkRef("beat", c.beat, `Consequence ${c.id}`);
    // Payoff must be at or after the seed assignment's milestone.
    const seedAsg = ("issue" in c.seed ? c.seed.issue : c.seed.decision_point).split(".")[0]!;
    const seedM = pkg.assignments.find((a) => a.id === seedAsg)?.milestone;
    const order = (id: string | undefined) => pkg.milestones.find((m) => m.id === id)?.order ?? 0;
    if (seedM && order(c.payoff_milestone) < order(seedM)) err(`Consequence ${c.id} pays off in ${c.payoff_milestone}, before its seed in ${seedM}`);
    const beat = pkg.beats.find((b) => b.id === c.beat);
    if (beat) {
      const refs = [...conditionRefs(beat.trigger)];
      if (!refs.some((r) => r.kind === "consequence" && r.id === c.id)) warn(`Beat ${beat.id} is the payoff for ${c.id} but its trigger does not reference consequence_active ${c.id}`);
    }
  }
  for (const b of pkg.beats) {
    checkCond(b.trigger, `Beat ${b.id} trigger`);
    checkRef("character", b.sender, `Beat ${b.id} sender`);
    for (const t of [...b.to, ...b.cc]) if (t !== "associate") checkRef("character", t, `Beat ${b.id} recipients`);
    for (const d of b.attachments) checkRef("document", d, `Beat ${b.id} attachments`);
    for (const k of b.must_include_facts) checkRef("fact", k, `Beat ${b.id} must_include_facts`);
    for (const a of b.after) checkRef("beat", a, `Beat ${b.id} after`);
    if (b.opens_assignment) checkRef("assignment", b.opens_assignment, `Beat ${b.id} opens_assignment`);
    const sender = pkg.characters.find((c) => c.id === b.sender);
    if (sender?.is_doctrine_assistant) err(`Beat ${b.id}: the doctrine assistant never initiates email`);
  }
  for (const c of pkg.characters) {
    for (const d of c.knows.documents) checkRef("document", d, `Character ${c.id} knows.documents`);
    for (const fk of c.knows.facts) {
      if (fk.endsWith(".*")) {
        const prefix = fk.slice(0, -1);
        if (![...ids.fact].some((k) => k.startsWith(prefix))) warn(`Character ${c.id} knows fact prefix ${fk} which matches nothing`);
      } else checkRef("fact", fk, `Character ${c.id} knows.facts`);
    }
    if (c.is_doctrine_assistant && (c.knows.facts.length || c.knows.documents.length)) err(`Doctrine assistant ${c.id} must have an empty knowledge slice`);
  }
  for (const d of pkg.deltas) {
    checkRef("document", d.document, `Delta ${d.id}`);
    checkRef("milestone", d.surfaces_in, `Delta ${d.id}`);
  }
  for (const v of pkg.verification) {
    checkRef("assignment", v.assignment, `Verification ${v.id}`);
    checkRef("document", v.draft_document, `Verification ${v.id}`);
    for (const s of v.source_documents) checkRef("document", s, `Verification ${v.id}`);
    for (const f of v.known_flaws) checkRef("issue", f.issue, `Verification flaw ${f.id}`);
  }
  for (const n of pkg.negotiation) if (n.delta) checkRef("delta", n.delta, `Negotiation ${n.id}`);
  for (const d of pkg.documents) {
    checkRef("character", d.from, `Document ${d.id}`);
    if (dir && !fs.existsSync(path.join(dir, "documents", d.source))) err(`Document ${d.id} source file missing: documents/${d.source}`);
  }
  // Every assignment must open somewhere: a beat that opens it.
  for (const a of pkg.assignments) {
    if (!pkg.beats.some((b) => b.opens_assignment === a.id)) err(`No beat opens assignment ${a.id}`);
  }
  // Doctrine assistant present exactly once.
  const doctrine = pkg.characters.filter((c) => c.is_doctrine_assistant);
  if (doctrine.length !== 1) err(`Exactly one doctrine assistant is required; found ${doctrine.length}`);
  if (pkg.meta.status === "draft") warn(`Scenario ${pkg.meta.id} is DRAFT content: not attorney-reviewed. Do not run a paid cohort on it.`);
  return out;
}
