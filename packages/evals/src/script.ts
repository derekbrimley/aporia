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
});
export type BotScript = z.infer<typeof BotScriptSchema>;

export function loadBotScript(scenarioId: string): BotScript {
  const file = path.join(scenarioDir(scenarioId), "bot-script.yaml");
  if (!fs.existsSync(file)) throw new Error(`No bot-script.yaml for scenario ${scenarioId}; the eval bot needs one.`);
  return BotScriptSchema.parse(YAML.parse(fs.readFileSync(file, "utf8")));
}
