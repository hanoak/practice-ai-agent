import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";

// Stage 2 — First tools
// The agent can now DO things, not just talk: read files, write files, and do
// math. We define the tools, hand them to Claude, and — by hand — run whatever
// tool Claude asks for and feed the result back. This is the "tool-use loop".
//   npm run dev
// Try: "What is (2+3)*7?"  |  "Write a haiku to poem.txt"  |  "Read poem.txt"

const client = new Anthropic({
  // maxRetries: retry transient failures (429 / 5xx / 529 overloaded) with backoff.
  maxRetries: 5,
});

const SYSTEM_PROMPT =
  "You are a concise, friendly CLI assistant with access to tools for reading " +
  "files, writing files, and doing math. Use a tool whenever it helps; do not " +
  "guess at file contents or arithmetic you could compute.";

// Model is env-configurable:  MODEL=claude-haiku-4-5 npm run dev
const MODEL = process.env.MODEL ?? "claude-sonnet-5";

// Safety valve: never let the tool-use loop run away. A misbehaving model (or a
// tool that keeps erroring) could otherwise loop forever, burning tokens.
const MAX_STEPS = 10;

// ---------------------------------------------------------------------------
// Tool definitions — the "menu" we show Claude. Each has a name, a description
// (Claude reads this to decide when to use it), and a JSON Schema for its input.
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: "calculator",
    description:
      "Evaluate a basic arithmetic expression. Use this for any math instead " +
      "of computing it yourself.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Arithmetic only, e.g. (2 + 3) * 7",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file and return its full contents.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path, relative to the current directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write (creating or overwriting) a UTF-8 text file.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path, relative to the current directory.",
        },
        content: { type: "string", description: "The full text to write." },
      },
      required: ["path", "content"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution — YOUR code runs the tools. Claude never touches the machine;
// it only asks, and we decide what actually happens. This is the security
// boundary: everything here is where you'd add validation, sandboxing, limits.
// ---------------------------------------------------------------------------
async function runTool(
  name: string,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "calculator": {
        const expression = String(args.expression ?? "");
        // Only allow digits, whitespace, and arithmetic characters — never run
        // arbitrary model-supplied code. This whitelist is the safety check.
        if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
          return {
            content: "Error: only numbers and + - * / ( ) . are allowed.",
            isError: true,
          };
        }
        const result = Function(`"use strict"; return (${expression});`)();
        return { content: String(result), isError: false };
      }
      case "read_file": {
        const text = await readFile(String(args.path ?? ""), "utf8");
        return { content: text, isError: false };
      }
      case "write_file": {
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        await writeFile(path, content, "utf8");
        return {
          content: `Wrote ${content.length} characters to ${path}.`,
          isError: false,
        };
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    // Tool failures are returned to Claude (is_error: true), not thrown — so it
    // can read the error and adjust, e.g. try a different filename.
    const detail = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${detail}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// The chat loop
// ---------------------------------------------------------------------------
const messages: Anthropic.MessageParam[] = [];
const rl = readline.createInterface({ input: stdin, output: stdout });

console.log('Chat started (with tools). Type "exit" or "quit" to leave.\n');

while (true) {
  const userInput = (await rl.question("You: ")).trim();
  if (userInput === "") continue;
  if (userInput === "exit" || userInput === "quit") break;

  // Remember where this turn began, so we can cleanly roll back on error.
  const historyMark = messages.length;
  messages.push({ role: "user", content: userInput });

  try {
    // The tool-use loop: keep going until Claude stops asking for tools.
    for (let step = 0; step < MAX_STEPS; step++) {
      stdout.write("\nClaude: ");
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages,
        tools,
      });
      stream.on("text", (delta) => stdout.write(delta));
      const final = await stream.finalMessage();

      // Record the assistant turn — the FULL content, which may include
      // tool_use blocks (not just text). Those blocks must stay in history.
      messages.push({ role: "assistant", content: final.content });

      // If Claude didn't ask for a tool, this turn is done.
      if (final.stop_reason !== "tool_use") {
        stdout.write("\n\n");
        break;
      }

      // Otherwise, run every tool Claude requested and gather the results.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type === "tool_use") {
          stdout.write(`\n  ↳ ${block.name}(${JSON.stringify(block.input)})`);
          const { content, isError } = await runTool(block.name, block.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id, // must match the tool_use block's id
            content,
            is_error: isError,
          });
        }
      }

      // Feed the results back as a user turn, then loop so Claude can react.
      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    // Roll the whole turn out of history so it can be retried cleanly.
    messages.length = historyMark;
    if (err instanceof Anthropic.APIError && err.status === 529) {
      stdout.write(
        "\n[Claude is overloaded (529) — temporary Anthropic-side issue. Try again.]\n\n",
      );
    } else {
      const detail = err instanceof Error ? err.message : String(err);
      stdout.write(`\n[Request failed: ${detail} — try again.]\n\n`);
    }
  }
}

rl.close();
console.log("Bye!");
