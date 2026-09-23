import { z } from "zod";
import type { Assignment, Delta } from "../deps.js";

export const ASSESSOR_VERSION = "assessor@1.0.0";

export const AssessmentOutputSchema = z.object({
  issues: z.array(z.object({
    id: z.string(),
    status: z.enum(["raised", "partial", "missed"]),
    evidence: z.string().describe("Short quote or paraphrase from the deliverable, or 'not present'"),
  })),
  decisions: z.array(z.object({
    id: z.string(),
    position: z.string().describe("The position id (P1, P2, ...) the deliverable takes, or 'none'"),
    evidence: z.string(),
  })),
  rationale_quality: z.enum(["absent", "thin", "adequate", "strong"]),
  summary: z.string().describe("Two sentences for the reflection engine on what the associate got hold of and what they did not, without judgement words"),
});
export type AssessmentOutput = z.infer<typeof AssessmentOutputSchema>;

/**
 * The assessor is the only runtime role besides the reflection engine and the
 * debrief that may read the answer key. It never scores and nothing it produces
 * is shown to the associate.
 */
export function assessorPrompt(input: { assignment: Assignment; deltas: Delta[]; deliverable: string; rationale: string | null; quotedRefs: { documentId: string; ref: string }[] }) {
  const a = input.assignment;
  const system = `You map a junior lawyer's deliverable onto an assignment's answer key. You are precise and literal: an issue is "raised" only if the deliverable actually makes the point described under "raised looks like" (in any words); "partial" if it matches "partial looks like" or gestures at the issue without the substance; otherwise "missed". You never score, grade or comment on quality beyond the fields requested. Output JSON matching the schema exactly; include every issue id and every decision point id from the answer key.`;
  const issues = a.issues.map((i) => `- ${i.id} [${i.tier}] ${i.title}\n  Description: ${i.description}\n  Raised looks like: ${i.raised_looks_like}${i.partial_looks_like ? `\n  Partial looks like: ${i.partial_looks_like}` : ""}${i.delta ? `\n  Related delta: ${i.delta}` : ""}`).join("\n");
  const dps = a.decision_points.map((d) => `- ${d.id} ${d.title}: ${d.question}\n${d.positions.map((p) => `    ${p.id}: ${p.label}. ${p.description}`).join("\n")}`).join("\n");
  const deltas = input.deltas.length ? `\nTerm sheet vs. document deltas relevant here:\n${input.deltas.map((d) => `- ${d.id} ${d.provision} (${d.section_ref ?? d.document}): term sheet says "${d.term_sheet_says}"; document says "${d.document_says}".`).join("\n")}` : "";
  const user = `Assignment ${a.id}: ${a.title}\nDeliverable expected: ${a.deliverable}\n\nAnswer key issues:\n${issues || "(none)"}\n\nDecision points:\n${dps || "(none)"}${deltas}\n\nThe associate's deliverable:\n"""\n${input.deliverable}\n"""\n${input.quotedRefs.length ? `\nPassages the associate quoted from documents: ${input.quotedRefs.map((q) => `${q.documentId} ${q.ref}`).join("; ")}` : ""}\nPrivate rationale written at send: ${input.rationale ? `"""\n${input.rationale}\n"""` : "(none)"}`;
  return { system, user, version: ASSESSOR_VERSION };
}
