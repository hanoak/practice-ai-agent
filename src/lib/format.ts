import type Anthropic from "@anthropic-ai/sdk";

// Turn any thrown value into a short error string. Tools return this (rather
// than throwing) so Claude can read the error and recover.
export function fail(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

// Flatten the structured message history into a plain-text transcript, used by
// the /summary feature so it can summarize from simple text.
export function transcript(msgs: Anthropic.Beta.BetaMessageParam[]): string {
  const lines: string[] = [];
  for (const m of msgs) {
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else {
      for (const block of m.content) {
        if (block.type === "text") text += block.text + " ";
        else if (block.type === "tool_use") text += `[called ${block.name}] `;
      }
    }
    text = text.trim();
    if (text) lines.push(`${m.role}: ${text}`);
  }
  return lines.join("\n");
}
