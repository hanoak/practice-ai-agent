import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Stage 3 — The agentic loop, driven by the SDK
// Same behavior as Stage 2, but the hand-written tool-use loop is GONE. Each
// tool is now defined in one place (name + description + schema + run), and
// client.beta.messages.toolRunner() drives the whole request → run tool →
// feed-back cycle for us.
//   npm run dev

const client = new Anthropic({
  maxRetries: 5, // retry transient 429 / 5xx / 529 failures with backoff
});

const SYSTEM_PROMPT =
  "You are a concise, friendly CLI assistant with access to tools for reading " +
  "files, writing files, and doing math. Use a tool whenever it helps; do not " +
  "guess at file contents or arithmetic you could compute.";

const MODEL = process.env.MODEL ?? "claude-sonnet-5";

// Cap the runner's internal loop so a misbehaving turn can't run away.
const MAX_STEPS = 10;

// Small helper so every tool reports errors as text (which Claude can read and
// recover from) instead of throwing (which would abort the whole turn).
function fail(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

// ---------------------------------------------------------------------------
// Tools — each is now defined ONCE. betaZodTool bundles the name, description,
// input schema (a Zod object, which also gives us typed `args`), and the run
// function together. Compare this to Stage 2, where the schema lived in a
// `tools` array and the implementation lived in a separate `runTool` switch.
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
      // Only allow arithmetic characters — never run arbitrary model code.
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
// The chat loop. Notice what's NO LONGER here: no checking stop_reason, no
// executing tools, no assembling tool_result blocks, no inner while-loop. The
// runner does all of that. We just feed it the history and consume the output.
// ---------------------------------------------------------------------------
let messages: Anthropic.Beta.BetaMessageParam[] = [];
const rl = readline.createInterface({ input: stdin, output: stdout });

console.log('Chat started (tool runner). Type "exit" or "quit" to leave.\n');

while (true) {
  const userInput = (await rl.question("You: ")).trim();
  if (userInput === "") continue;
  if (userInput === "exit" || userInput === "quit") break;

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
      // Non-streaming. In this SDK version the *streaming* tool runner leaks a
      // `parsed` field from finalMessage() back into the re-sent history, which
      // the API rejects (400 "text.parsed: Extra inputs are not permitted").
      // The non-streaming path returns clean message params. Tool calls stay
      // visible via the `↳` logs inside each tool's run function.
      stream: false,
    });

    // Each iteration is one assistant turn (a BetaMessage). The runner executes
    // any requested tools between turns via their run functions above.
    for await (const message of runner) {
      let text = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
      }
      if (text.trim()) stdout.write(`\nClaude: ${text}\n`);
    }
    stdout.write("\n");

    // Sync our history with everything the runner accumulated this turn:
    // assistant text, the tool_use blocks, and the tool_result blocks.
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
