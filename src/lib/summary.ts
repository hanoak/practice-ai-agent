import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { client, MODEL } from "../config";
import { fail, transcript } from "./format";

// Structured output — the shape we want back from /summary. This Zod schema is
// BOTH the runtime validator AND the TypeScript type: parse() returns an object
// guaranteed to match it, and `s.sentiment` is typed as the enum.
const SummarySchema = z.object({
  title: z.string().describe("A short title for the conversation"),
  keyPoints: z.array(z.string()).describe("The main points discussed"),
  actionItems: z
    .array(z.string())
    .describe("Any tasks or follow-ups; empty array if none"),
  sentiment: z
    .enum(["positive", "neutral", "negative"])
    .describe("Overall tone of the conversation"),
});

// Ask the model for a typed, schema-validated summary of the conversation. No
// tools here — output_format constrains the reply to the schema.
export async function summarize(
  messages: Anthropic.Beta.BetaMessageParam[],
): Promise<void> {
  if (messages.length === 0) {
    console.log("Nothing to summarize yet — have a conversation first.\n");
    return;
  }
  try {
    const result = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: "You produce accurate, concise structured summaries.",
      messages: [
        {
          role: "user",
          content:
            "Summarize the following conversation as structured data.\n\n" +
            transcript(messages),
        },
      ],
      output_format: betaZodOutputFormat(SummarySchema),
    });
    const s = result.parsed_output;
    if (!s) {
      console.log("Could not produce a summary.\n");
      return;
    }
    console.log("\n── Summary ──");
    console.log(`Title:     ${s.title}`);
    console.log(`Sentiment: ${s.sentiment}`);
    console.log("Key points:");
    for (const point of s.keyPoints) console.log(`  • ${point}`);
    if (s.actionItems.length > 0) {
      console.log("Action items:");
      for (const item of s.actionItems) console.log(`  • ${item}`);
    }
    console.log();
  } catch (err) {
    console.log(`[Summary failed: ${fail(err)} — try again.]\n`);
  }
}
