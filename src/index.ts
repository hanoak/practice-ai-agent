import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool, betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Stage 4 — Structured output & polish
// Free-form chat is great for humans, but sometimes YOUR CODE needs data it can
// rely on: fields with known names and types. This stage adds a /summary command
// that returns a typed, schema-validated object (not prose), plus a few polish
// commands (/help, /reset).
//   npm run dev

const client = new Anthropic({
  maxRetries: 5, // retry transient 429 / 5xx / 529 failures with backoff
});

const SYSTEM_PROMPT =
  "You are a concise, friendly CLI assistant with access to tools for reading " +
  "files, writing files, and doing math. Use a tool whenever it helps; do not " +
  "guess at file contents or arithmetic you could compute.";

const MODEL = process.env.MODEL ?? "claude-sonnet-5";
const MAX_STEPS = 10;

// Report tool errors as text (Claude can read and recover) instead of throwing.
function fail(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

// ---------------------------------------------------------------------------
// Structured output — the shape we want back from /summary. This Zod schema is
// BOTH the runtime validator AND the TypeScript type: parse() returns an object
// guaranteed to match it, and `summary.sentiment` is typed as the enum.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Tools (unchanged from Stage 3) — defined once each with betaZodTool.
// ---------------------------------------------------------------------------
const tools = [
  betaZodTool({
    name: "calculator",
    description:
      "Evaluate a basic arithmetic expression. Use this for any math instead " +
      "of computing it yourself.",
    inputSchema: z.object({
      expression: z.string().describe("Arithmetic only, e.g. (2 + 3) * 7"),
    }),
    run: ({ expression }) => {
      stdout.write(`\n  ↳ calculator(${JSON.stringify({ expression })})`);
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return "Error: only numbers and + - * / ( ) . are allowed.";
      }
      try {
        return String(Function(`"use strict"; return (${expression});`)());
      } catch (err) {
        return fail(err);
      }
    },
  }),

  betaZodTool({
    name: "read_file",
    description: "Read a UTF-8 text file and return its full contents.",
    inputSchema: z.object({
      path: z.string().describe("File path, relative to the current directory."),
    }),
    run: async ({ path }) => {
      stdout.write(`\n  ↳ read_file(${JSON.stringify({ path })})`);
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        return fail(err);
      }
    },
  }),

  betaZodTool({
    name: "write_file",
    description: "Write (creating or overwriting) a UTF-8 text file.",
    inputSchema: z.object({
      path: z.string().describe("File path, relative to the current directory."),
      content: z.string().describe("The full text to write."),
    }),
    run: async ({ path, content }) => {
      stdout.write(`\n  ↳ write_file(${JSON.stringify({ path })})`);
      try {
        await writeFile(path, content, "utf8");
        return `Wrote ${content.length} characters to ${path}.`;
      } catch (err) {
        return fail(err);
      }
    },
  }),
];

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------
let messages: Anthropic.Beta.BetaMessageParam[] = [];

// Flatten the structured history into a plain text transcript. We summarize from
// this (not by replaying tool_use/tool_result blocks) so the request stays a
// simple single user message.
function transcript(msgs: Anthropic.Beta.BetaMessageParam[]): string {
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

// The structured-output call. Note: no tools, and output_format constrains the
// reply to our schema. parse() validates it and hands back a typed object.
async function summarize(): Promise<void> {
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

    const s = result.parsed_output; // typed as z.infer<typeof SummarySchema> | null
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

function printHelp(): void {
  console.log(`
Commands:
  /help      Show this help
  /summary   Structured summary of the conversation (typed + validated)
  /reset     Clear the conversation history
  exit|quit  Leave
Anything else is sent to the assistant, which can use tools.
`);
}

// ---------------------------------------------------------------------------
// The chat loop
// ---------------------------------------------------------------------------
const rl = readline.createInterface({ input: stdin, output: stdout });

console.log('Chat started. Type "/help" for commands.\n');

while (true) {
  const userInput = (await rl.question("You: ")).trim();
  if (userInput === "") continue;
  if (userInput === "exit" || userInput === "quit") break;

  // Slash commands are handled locally, not sent to the model.
  if (userInput === "/help") {
    printHelp();
    continue;
  }
  if (userInput === "/reset") {
    messages = [];
    console.log("Conversation cleared.\n");
    continue;
  }
  if (userInput === "/summary") {
    await summarize();
    continue;
  }

  const historyMark = messages.length;
  messages.push({ role: "user", content: userInput });

  try {
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      max_iterations: MAX_STEPS,
      // Non-streaming: this SDK version's streaming tool runner leaks a `parsed`
      // field into the re-sent history (400 "text.parsed: Extra inputs are not
      // permitted"). Tool calls stay visible via the `↳` logs.
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

    messages = [...runner.params.messages];
  } catch (err) {
    messages.length = historyMark; // roll the failed turn out of history
    if (err instanceof Anthropic.APIError && err.status === 529) {
      stdout.write(
        "\n[Claude is overloaded (529) — temporary Anthropic-side issue. Try again.]\n\n",
      );
    } else {
      stdout.write(`\n[Request failed: ${fail(err)} — try again.]\n\n`);
    }
  }
}

rl.close();
console.log("Bye!");
