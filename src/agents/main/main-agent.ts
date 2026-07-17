import { stdout } from "node:process";
import type Anthropic from "@anthropic-ai/sdk";
import { client, MODEL, MAX_STEPS, type Tools } from "../../config";
import { MAIN_SYSTEM_PROMPT } from "../../prompts/main";

// Run one user turn of the main agent to completion. The tool runner drives the
// request → run tool → feed-back loop; we just print assistant text as it comes
// and return the updated history. Throws on API error — the caller (the REPL)
// handles rollback so a failed turn can be retried.
//
// Non-streaming: this SDK version's streaming tool runner leaks a `parsed` field
// into the re-sent history (400 "text.parsed: Extra inputs are not permitted").
// Tool calls stay visible via the `↳` logs inside each tool's run function.
export async function runMainTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  tools: Tools,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 2048,
    system: MAIN_SYSTEM_PROMPT,
    messages,
    tools,
    max_iterations: MAX_STEPS,
    stream: false,
  });

  for await (const message of runner) {
    let text = "";
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
    }
    if (text.trim()) stdout.write(`\nClaude: ${text}\n`);
  }
  stdout.write("\n");

  // The runner accumulates the full turn (assistant text, tool_use blocks, and
  // tool_result blocks) in params.messages — return it as the new history.
  return [...runner.params.messages];
}
