import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { buildToolSets } from "./tools/tool-sets";
import { runMainTurn } from "./agents/main/main-agent";
import { loadSession, saveSession } from "./lib/session";
import { summarize } from "./lib/summary";
import { fail } from "./lib/format";

// practice-ai-agent — a CLI assistant built stage by stage.
// This entry point wires the pieces together and runs the REPL; the actual
// behavior lives in focused modules (config, prompts, tools, agents, lib).
//   npm run dev

// Launch the MCP servers and build each agent's tool set.
const { mainTools, mcpClients } = await buildToolSets();

console.log(
  "Connected to 2 MCP servers (filesystem + notes). Tools available:\n  " +
    mainTools.map((t) => t.name).join(", ") +
    "\n",
);

// Load the persisted conversation (empty on a first run).
let messages: Anthropic.Beta.BetaMessageParam[] = await loadSession();

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
    console.log(mainTools.map((t) => `  • ${t.name}`).join("\n") + "\n");
    continue;
  }
  if (userInput === "/reset") {
    messages = [];
    await saveSession(messages); // clear the persisted history too
    console.log("Conversation cleared.\n");
    continue;
  }
  if (userInput === "/summary") {
    await summarize(messages);
    continue;
  }

  const historyMark = messages.length;
  messages.push({ role: "user", content: userInput });

  try {
    messages = await runMainTurn(messages, mainTools);
    await saveSession(messages); // persist so the conversation survives a restart
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
for (const mcp of mcpClients) await mcp.close(); // shut down both MCP subprocesses
console.log("Bye!");
