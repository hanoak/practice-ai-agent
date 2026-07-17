import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool, betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Stage 5 — Connect to an existing MCP server
// Until now WE wrote every tool. MCP (Model Context Protocol) lets tools live in
// a separate server process that any MCP-aware app can use. Here we launch the
// official filesystem server as a subprocess, ask it what tools it offers, and
// wrap each so our tool runner (and thus Claude) can call it. The file tools we
// hand-wrote in Stage 2 are gone — the MCP server provides better ones for free.
//   npm run dev

const client = new Anthropic({
  maxRetries: 5, // retry transient 429 / 5xx / 529 failures with backoff
});

const SYSTEM_PROMPT =
  "You are a concise, friendly CLI assistant. You can do math and work with " +
  "files (read, write, list, search) via your tools. Use a tool whenever it " +
  "helps; do not guess at file contents or arithmetic you could compute.";

const MODEL = process.env.MODEL ?? "claude-sonnet-5";
const MAX_STEPS = 10;

function fail(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

// ---------------------------------------------------------------------------
// One LOCAL tool (calculator), to show local and MCP tools side by side. The
// file tools now come from the MCP server below.
// ---------------------------------------------------------------------------
const calculator = betaZodTool({
  name: "calculator",
  description:
    "Evaluate a basic arithmetic expression. Use this for any math instead of " +
    "computing it yourself.",
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
});

// ---------------------------------------------------------------------------
// MCP: launch servers and adopt their tools
// ---------------------------------------------------------------------------

function mcpResultToText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}

// Connect to one MCP server and return its tools, wrapped for our tool runner.
// A transport is HOW we talk to the server: stdio spawns it as a child process
// and speaks MCP over its stdin/stdout. Whatever the server exposes, we discover
// via listTools() and forward each call back to it via callTool() — the tool
// IMPLEMENTATIONS live in the server, not here. This one helper now works for
// BOTH the third-party filesystem server and our own notes server.
async function adoptMcpServer(command: string, args: string[]) {
  const transport = new StdioClientTransport({ command, args });
  const mcp = new Client({ name: "practice-ai-agent", version: "0.1.0" });
  await mcp.connect(transport);

  const { tools: defs } = await mcp.listTools();
  const tools = defs.map((def) =>
    betaTool({
      name: def.name,
      description: def.description ?? "",
      // MCP input schemas are dynamic; betaTool wants a typed const schema, so
      // we cast. The runner still validates args against it before run().
      inputSchema: def.inputSchema as Parameters<typeof betaTool>[0]["inputSchema"],
      run: async (args) => {
        stdout.write(`\n  ↳ ${def.name}(${JSON.stringify(args)})`);
        const result = await mcp.callTool({
          name: def.name,
          arguments: args as Record<string, unknown>,
        });
        return mcpResultToText(result);
      },
    }),
  );

  return { mcp, tools };
}

// Server 1: the third-party filesystem server (sandboxed to this directory).
const filesystem = await adoptMcpServer("npx", [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  process.cwd(),
]);

// Server 2: OUR OWN notes server, run with tsx. Same protocol, same wiring —
// the client can't tell it's homegrown.
const notes = await adoptMcpServer("npx", ["tsx", "src/server.ts"]);

// Clients to shut down on exit.
const mcpClients = [filesystem.mcp, notes.mcp];

// One local tool + tools from both servers, all treated identically.
const tools = [calculator, ...filesystem.tools, ...notes.tools];

console.log(
  "Connected to 2 MCP servers (filesystem + notes). Tools available:\n  " +
    tools.map((t) => t.name).join(", ") +
    "\n",
);

// ---------------------------------------------------------------------------
// Structured output (/summary) — unchanged from Stage 4
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

let messages: Anthropic.Beta.BetaMessageParam[] = [];

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

function printHelp(): void {
  console.log(`
Commands:
  /help      Show this help
  /tools     List the tools currently available (local + MCP)
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

  if (userInput === "/help") {
    printHelp();
    continue;
  }
  if (userInput === "/tools") {
    console.log(tools.map((t) => `  • ${t.name}`).join("\n") + "\n");
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
      stream: false, // streaming runner leaks a `parsed` field (see Stage 3)
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
    messages.length = historyMark;
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
for (const mcp of mcpClients) await mcp.close(); // shut down both MCP subprocesses
console.log("Bye!");
