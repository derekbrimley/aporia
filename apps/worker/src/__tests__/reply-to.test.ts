import { describe, it, expect } from "vitest";
import type { SessionState } from "@rematter/engine";
import { renderThread } from "@rematter/prompts";
import { loadScenario, scenarioDir } from "@rematter/scenario";
import { Names, threadForPrompt } from "../context.js";

const { pkg } = loadScenario(scenarioDir("acme-merger-01"));
const names = new Names(pkg, "Austin");

function msg(id: string, from: string, body: string, inReplyTo: string | null = null) {
  return { id, threadId: "t1", from, to: ["associate"], cc: [], kind: "reply", attachments: [], body, at: "2026-11-13T15:00:00Z", inReplyTo };
}
function stateWith(messages: ReturnType<typeof msg>[]): SessionState {
  return {
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
    messageOrder: messages.map((m) => m.id),
    threads: { t1: { id: "t1", messageIds: messages.map((m) => m.id) } },
  } as unknown as SessionState;
}

describe("replies on an earlier email in prompts", () => {
  it("notes the earlier email a reply answers, but not a reply to the email just above it", () => {
    const s = stateWith([
      msg("g1", "client_contact", "Can you check the   forbearance dates?"),
      msg("p1", "partner", "Also look at the lender consents.", null),
      msg("a1", "associate", "The dates line up.", "g1"),
      msg("a2", "associate", "Consents are fine.", "a1"),
    ]);
    const thread = threadForPrompt(s, "t1", names);
    expect(thread[2]!.replyingTo).toEqual({ from: names.name("client_contact"), at: "2026-11-13 15:00", excerpt: "Can you check the forbearance dates?" });
    expect(thread[3]!.replyingTo).toBeNull();
    expect(thread[0]!.replyingTo).toBeNull();
    const text = renderThread(thread);
    expect(text).toContain(`In reply to: ${names.name("client_contact")}'s email of 2026-11-13 15:00 ("Can you check the forbearance dates?")`);
    expect(text.match(/In reply to/g)).toHaveLength(1);
  });
});
