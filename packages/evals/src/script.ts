import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { scenarioDir } from "@rematter/scenario";

/**
 * The bot associate's scripted, scenario-specific lines: the off-script and doctrine probes,
 * replies on reply-completion threads, and answers to interruptions and reflections. Lives beside
 * the scenario as `bot-script.yaml` because it quotes the deal; it is test-only and never shipped
 * to a session.
 */
export const BotScriptSchema = z.object({
  /** Beat after which the off-script email and doctrine question go out. */
  probe_beat: z.string(),
  /** Beat after which a gap_days path simulates time away. */
  gap_beat: z.string(),
  off_script: z.object({ to: z.array(z.string()).min(1), subject: z.string(), body: z.string() }),
  doctrine: z.object({ general: z.string(), asks_for_answer: z.string() }),
  /** Replies on a `replies`-completion thread: the first, then every later one. */
  replies: z.object({ first: z.string(), later: z.string() }),
  interruption_reply: z.string(),
  reflection_reply: z.object({ thin: z.string(), full: z.string() }),
  /** Realistic-tester lines. Deal-neutral defaults, so a scenario only overrides them to sound like itself. */
  // Long enough (60+ words) to look like work, as Austin's follow-ups did, so the follow-up-thread rules are exercised.
  reflection_followup: z.string().default("Thanks, that's helpful. Picking up your point about where the client stands: I think most of the risk is in the timing, since nothing protects us if the other side drags its feet before signing, and the documents don't give us a clean way out if they do. I could add a paragraph on that and on what we would ask for in return. Should I revise the note and send it to you again before it goes out, or is it fine as it is?"),
  stuck_question: z.string().default("I've been through the documents a couple of times and I'm still not sure what I should be focusing on for this. Can you point me in the right direction?"),
  quick_followup: z.string().default("One more thing, sorry: is there a deadline I should be working to?"),
});
export type BotScript = z.infer<typeof BotScriptSchema>;

export function loadBotScript(scenarioId: string): BotScript {
  const file = path.join(scenarioDir(scenarioId), "bot-script.yaml");
  if (!fs.existsSync(file))
    throw new Error(`No bot-script.yaml for scenario ${scenarioId}; the eval bot needs one.`);
  return BotScriptSchema.parse(YAML.parse(fs.readFileSync(file, "utf8")));
}
