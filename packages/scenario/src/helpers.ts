import type { Assignment, Character, Consequence, DecisionPoint, Issue, Milestone, ScenarioPackage } from "./schema.js";

/** Indexed lookups over a validated package. Pure and cheap to build. */
export class ScenarioIndex {
  readonly characters = new Map<string, Character>();
  readonly milestones = new Map<string, Milestone>();
  readonly milestonesInOrder: Milestone[];
  readonly assignments = new Map<string, Assignment>();
  readonly issues = new Map<string, Issue & { assignment: string }>();
  readonly decisionPoints = new Map<string, DecisionPoint & { assignment: string }>();
  readonly consequences = new Map<string, Consequence>();
  readonly assignmentsByThread = new Map<string, Assignment[]>();

  constructor(readonly pkg: ScenarioPackage) {
    for (const c of pkg.characters) this.characters.set(c.id, c);
    for (const m of pkg.milestones) this.milestones.set(m.id, m);
    this.milestonesInOrder = [...pkg.milestones].sort((a, b) => a.order - b.order);
    for (const a of pkg.assignments) {
      this.assignments.set(a.id, a);
      for (const i of a.issues) this.issues.set(i.id, { ...i, assignment: a.id });
      for (const d of a.decision_points) this.decisionPoints.set(d.id, { ...d, assignment: a.id });
      const list = this.assignmentsByThread.get(a.thread_key) ?? [];
      list.push(a);
      this.assignmentsByThread.set(a.thread_key, list);
    }
    for (const c of pkg.consequences) this.consequences.set(c.id, c);
  }

  character(id: string): Character {
    const c = this.characters.get(id);
    if (!c) throw new Error(`Unknown character ${id}`);
    return c;
  }
  characterByEmail(email: string): Character | undefined {
    const e = email.toLowerCase();
    return this.pkg.characters.find((c) => c.email.toLowerCase() === e);
  }
  get doctrineAssistant(): Character {
    return this.pkg.characters.find((c) => c.is_doctrine_assistant)!;
  }
  milestone(id: string): Milestone {
    const m = this.milestones.get(id);
    if (!m) throw new Error(`Unknown milestone ${id}`);
    return m;
  }
  nextMilestone(id: string): Milestone | undefined {
    const m = this.milestone(id);
    return this.milestonesInOrder.find((x) => x.order === m.order + 1);
  }
  get firstMilestone(): Milestone {
    return this.milestonesInOrder[0]!;
  }
  get lastMilestone(): Milestone {
    return this.milestonesInOrder[this.milestonesInOrder.length - 1]!;
  }
  assignment(id: string): Assignment {
    const a = this.assignments.get(id);
    if (!a) throw new Error(`Unknown assignment ${id}`);
    return a;
  }
  document(id: string) {
    const d = this.pkg.documents.find((x) => x.id === id);
    if (!d) throw new Error(`Unknown document ${id}`);
    return d;
  }
}
