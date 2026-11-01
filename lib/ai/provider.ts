// Which AI provider answers (spec 21): Claude when an API key is set, the deterministic local one otherwise.
import { claudeAi } from "./claude";
import { localAi } from "./local";
import type { AiProvider } from "./types";

export function aiProvider(): AiProvider {
  return process.env.ANTHROPIC_API_KEY ? claudeAi() : localAi;
}
