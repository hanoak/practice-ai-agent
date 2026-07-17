import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool, betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Stage 9 — Consume a published MCP server
// The notes server is no longer a local file — it's `sample-notes-mcp-server`,
// published to npm and installed as a dependency. We launch it exactly like the
// third-party filesystem server (npx + a path arg), which is the whole point of
// MCP: our own server is now interchangeable infrastructure anyone can install.
// (Everything from Stages 1–8 still applies: memory, tools, /summary, session
// persistence, and the researcher sub-agent.)
//   npm run dev

const client = new Anthropic({
  maxRetries: 5, // retry transient 429 / 5xx / 529 failures with backoff
});

const SYSTEM_PROMPT =
  "You are a concise, friendly CLI assistant. You can do math and work with " +
  "files (read, write, list, search) via your tools. Use a tool whenever it " +
  "helps; do not guess at file contents or arithmetic you could compute. " +
  "For questions that need digging through the project's files or the saved " +
  "notes, delegate to the researcher via the ask_researcher tool.";

const MODEL = process.env.MODEL ?? "claude-sonnet-5";
const MAX_STEPS = 10;

// Where the conversation is persisted between runs.
const SESSION_FILE = "session.json";

function fail(err: unknown): string {
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

// Load the saved conversation (empty if there isn't one yet). The saved history
// includes tool_use / tool_result blocks, so a resumed session is complete.
async function loadSession(): Promise<Anthropic.Beta.BetaMessageParam[]> {
  try {
    return JSON.parse(
      await readFile(SESSION_FILE, "utf8"),
    ) as Anthropic.Beta.BetaMessageParam[];
  } catch {
    return []; // no file yet, or unreadable → start fresh
  }
}

async function saveSession(
  msgs: Anthropic.Beta.BetaMessageParam[],
): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(msgs, null, 2), "utf8");
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

// Server 2: our notes server — now the PUBLISHED sample-notes-mcp-server package
// (installed from npm), launched via npx with the notes-file path. Same helper,
// same protocol; it's just another installable MCP server now.
const notes = await adoptMcpServer("npx", [
  "-y",
  "sample-notes-mcp-server",
  "notes.json",
]);

// Clients to shut down on exit.
const mcpClients = [filesystem.mcp, notes.mcp];

// ---------------------------------------------------------------------------
// A researcher SUB-AGENT, exposed to the main agent as a single tool.
// ---------------------------------------------------------------------------
const RESEARCHER_SYSTEM =
  "You are a focused research assistant. Use your file and note tools to dig " +
  "into the user's project and notes, then answer the question concisely with " +
  "specific findings. Reference file names or note ids where relevant.";

// The researcher gets the file + note tools — but NOT ask_researcher itself, so
// it can't recursively delegate to another researcher forever.
const researcherTools = [...filesystem.tools, ...notes.tools];

const askResearcher = betaZodTool({
  name: "ask_researcher",
  description:
    "Delegate a question to a researcher sub-agent that can read files and " +
    "search notes. Use this for questions that require digging through the " +
    "project's files or the saved notes. Returns the researcher's findings.",
  inputSchema: z.object({
    question: z.string().describe("The research question for the sub-agent."),
  }),
  run: async ({ question }) => {
    stdout.write(`\n  ↳ ask_researcher(${JSON.stringify({ question })})`);
    try {
      // A whole separate agent conversation: its own system prompt, its own
      // tools, its own tool-use loop. Awaiting the runner runs it to completion
      // and returns the sub-agent's final message.
      const finalMessage = await client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 2048,
        system: RESEARCHER_SYSTEM,
        messages: [{ role: "user", content: question }],
        tools: researcherTools,
        max_iterations: MAX_STEPS,
        stream: false,
      });
      let findings = "";
      for (const block of finalMessage.content) {
        if (block.type === "text") findings += block.text;
      }
      return findings.trim() || "(the researcher returned no findings)";
    } catch (err) {
      return fail(err);
    }
  },
});

// Main agent tools: local calculator + both MCP servers + the researcher.
const tools = [calculator, ...filesystem.tools, ...notes.tools, askResearcher];

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

let messages: Anthropic.Beta.BetaMessageParam[] = await loadSession();

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

if (messages.length > 0) {
  console.log(
    `Resumed your previous session (${messages.length} messages). "/reset" starts fresh.`,
  );
}
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
    await saveSession(messages); // clear the persisted history too
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
    await saveSession(messages); // persist so the conversation survives a restart
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
