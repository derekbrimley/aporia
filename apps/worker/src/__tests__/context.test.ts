import { describe, it, expect } from "vitest";
import type { SessionState } from "@rematter/engine";
import { loadScenario, scenarioDir } from "@rematter/scenario";
import { Names, answeredSince, associateDocuments, sentAt, storyDate } from "../context.js";

const { pkg } = loadScenario(scenarioDir("acme-merger-01"));
const names = new Names(pkg, "Austin");

function msg(id: string, from: string, to: string[], kind: string, attachments: string[] = []) {
  return { id, threadId: "t1", from, to, cc: [], kind, attachments, body: "", at: "2026-11-13T00:00:00Z" };
}

function stateWith(messages: ReturnType<typeof msg>[]): SessionState {
  return {
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
    messageOrder: messages.map((m) => m.id),
    threads: { t1: { id: "t1", messageIds: messages.map((m) => m.id) } },
  } as unknown as SessionState;
}

describe("worker context helpers", () => {
  it("skips a second reply when the character already answered after the email", () => {
    // Austin writes twice; Grace's reply to the first went out after the second arrived.
    const s = stateWith([msg("a1", "associate", ["client_contact"], "associate"), msg("a2", "associate", ["client_contact"], "associate"), msg("g1", "client_contact", ["associate"], "reply")]);
    expect(answeredSince(s, "t1", "a2", "client_contact")).toBe(true);
    expect(answeredSince(s, "t1", "a2", "senior_associate")).toBe(false);
    // A scripted beat on the thread doesn't count as an answer.
    const b = stateWith([msg("a1", "associate", ["client_contact"], "associate"), msg("g1", "client_contact", ["associate"], "beat")]);
    expect(answeredSince(b, "t1", "a1", "client_contact")).toBe(false);
  });

  it("lists only the documents the associate has received", () => {
    const s = stateWith([msg("b1", "client_contact", ["associate"], "beat", ["letter-of-intent", "bigbank-term-sheet"]), msg("b2", "client_contact", ["senior_associate"], "beat", ["dr-capitalization"])]);
    const docs = associateDocuments(s, names);
    expect(docs).toHaveLength(2);
    expect(docs.join(" ")).not.toMatch(/capitaliz/i);
  });

  it("dates the story and email times on the associate's clock", () => {
    const at = "2026-11-13T00:07:52Z";
    expect(storyDate(at)).toBe("November 13, 2026");
    expect(storyDate(at, "America/Denver")).toBe("November 12, 2026");
    expect(storyDate(at, "Bogus/Zone")).toBe("November 13, 2026");
    expect(sentAt(at, null)).toBe("2026-11-13 00:07");
    expect(sentAt(at, "America/Denver")).toBe("2026-11-12 17:07");
  });
});
