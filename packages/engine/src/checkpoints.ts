import type { ScenarioPackage } from "@rematter/scenario";
import { initialState } from "./state.js";
import { step } from "./step.js";
import type { EngineEvent, SessionState, StepOptions } from "./types.js";

/**
 * Test checkpoints: points in a finished run that another session can be loaded from.
 *
 * A checkpoint is a prefix of a source session's event log. Replaying that prefix rebuilds the
 * inbox exactly, AI-written emails included, with no model calls. Each milestone's checkpoint is
 * the moment it becomes the associate's turn: the milestone has been entered and the world has
 * spoken, but the associate hasn't done anything in it yet.
 */
export interface Checkpoint {
  /** Number of source events the checkpoint keeps. */
  eventCount: number;
  /** The milestone it starts at, or null for the end of the run. */
  milestoneId: string | null;
  label: string;
}

/** Events only the associate causes. The first one after a milestone starts ends its checkpoint. */
const ASSOCIATE_ACTIONS = new Set<EngineEvent["type"]>(["email_sent", "document_opened", "documents_compared", "flag_raised"]);

export function findCheckpoints(events: EngineEvent[], pkg: ScenarioPackage, opts: StepOptions = {}): Checkpoint[] {
  const out: Checkpoint[] = [];
  const order = [...pkg.milestones].sort((a, b) => a.order - b.order);
  let state: SessionState = initialState(pkg);
  // Milestone entered at event index i -> waiting for the associate's first action after i.
  let waiting: { id: string; title: string } | null = null;
  const seen = new Set<string>();
  events.forEach((e, i) => {
    if (waiting && ASSOCIATE_ACTIONS.has(e.type)) {
      out.push({ eventCount: i, milestoneId: waiting.id, label: `${waiting.id} · ${waiting.title}` });
      waiting = null;
    }
    state = step(state, e, pkg, opts).state;
    for (const m of order) {
      if (seen.has(m.id) || !state.milestones[m.id]?.enteredAt) continue;
      seen.add(m.id);
      waiting = { id: m.id, title: m.title };
    }
  });
  if (waiting) {
    const w = waiting as { id: string; title: string };
    out.push({ eventCount: events.length, milestoneId: w.id, label: `${w.id} · ${w.title}` });
  }
  if (state.status === "completed") out.push({ eventCount: events.length, milestoneId: null, label: "Deal closed (end of run)" });
  return out;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface ForkOptions {
  /** The time the last kept event should appear to have happened; every event shifts by the same amount. */
  now: string;
  /** Mints a fresh id for every id in the source payloads (messages and threads have global ids). */
  newId: () => string;
  /** The associate's first name in the new session; replaces the source's name in every text. */
  firstName: string;
}

/**
 * The first `eventCount` events of a source log, made safe to append to a new session: fresh ids
 * (consistently mapped, so threads and job keys still line up), times shifted so the last kept event
 * lands at `now`, and the associate renamed. Deal dates keep counting from the source run's start,
 * because the emails already written quote them.
 */
export function forkEvents(events: EngineEvent[], eventCount: number, opts: ForkOptions): EngineEvent[] {
  const kept = events.slice(0, eventCount);
  if (!kept.length) return [];
  const started = kept.find((e) => e.type === "session_started");
  const fromName = started?.type === "session_started" ? started.payload.associateFirstName : null;
  const anchor = started?.type === "session_started" ? started.payload.dateAnchor ?? started.at : null;
  const shift = Date.parse(opts.now) - Date.parse(kept[kept.length - 1]!.at);
  const ids = new Map<string, string>();
  const remapId = (id: string) => {
    const k = id.toLowerCase();
    if (!ids.has(k)) ids.set(k, opts.newId());
    return ids.get(k)!;
  };
  const nameRe = fromName && fromName !== opts.firstName ? new RegExp(`\\b${fromName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g") : null;
  const text = (s: string) => {
    const out = s.replace(UUID_RE, remapId);
    return nameRe ? out.replace(nameRe, opts.firstName) : out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return kept.map((e) => {
    const at = new Date(Date.parse(e.at) + shift).toISOString();
    if (e.type === "session_started") {
      return { ...e, at, payload: { ...e.payload, associateFirstName: opts.firstName, ...(anchor ? { dateAnchor: anchor } : {}) } };
    }
    return { ...e, at, payload: walk(e.payload) } as EngineEvent;
  });
}
