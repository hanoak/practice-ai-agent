# practice-ai-agent

A command-line AI assistant built **stage by stage** to learn AI agents, tool use, and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) — using TypeScript, Node.js, and the Claude API.

It's a chat agent that can do math, read and write files, take notes, remember the conversation across restarts, and delegate research to a second agent — with its file and note tools provided by MCP servers (one third-party, one published to npm).

## Features

- 💬 **Conversational** — multi-turn chat with a running history
- 🧮 **Tools** — a local `calculator` plus filesystem and notes tools from MCP servers
- 🔌 **MCP client** — adopts tools from the official filesystem server and the published [`sample-notes-mcp-server`](https://www.npmjs.com/package/sample-notes-mcp-server)
- 🧠 **Persistent memory** — the conversation is saved to `session.json` and resumed on the next run
- 🤝 **Sub-agent** — an `ask_researcher` tool delegates to a separate researcher agent with its own prompt and tools
- 📋 **Structured output** — `/summary` returns a typed, schema-validated summary
- 🔁 **Resilient** — retries transient API errors and never crashes the loop on a failed turn

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your Claude API key:

   ```bash
   cp .env.example .env
   # then edit .env and paste your key from https://console.anthropic.com/settings/keys
   ```

## Usage

```bash
npm run dev
```

On startup the app launches two MCP servers as subprocesses and adopts their tools. Then chat with it — try:

| Prompt | What happens |
| --- | --- |
| `What is (2 + 3) * 7?` | local `calculator` tool |
| `List the files here` | filesystem MCP server |
| `Remember that I prefer TypeScript`, then `What are my notes?` | notes MCP server |
| Tell it your name, quit, re-run, ask `What's my name?` | resumes from `session.json` |
| `Ask the researcher what this project does` | delegates to the researcher sub-agent |

**Commands:** `/help`, `/tools`, `/summary`, `/reset`, `exit` / `quit`.

**Switch models:** `MODEL=claude-haiku-4-5 npm run dev` (defaults to `claude-sonnet-5`).

## Project structure

```text
src/
├── index.ts                          # entry point: bootstrap + the REPL loop
├── config.ts                         # Anthropic client, MODEL, MAX_STEPS, SESSION_FILE, Tools type
├── prompts/
│   ├── main.ts                       # system prompt for the main agent
│   └── researcher.ts                 # system prompt for the researcher sub-agent
├── agents/
│   ├── main/main-agent.ts            # runs one main-agent turn (the tool-use loop)
│   └── researcher/researcher-agent.ts# the ask_researcher sub-agent tool
├── tools/
│   ├── calculator.ts                 # the local calculator tool
│   ├── mcp.ts                        # connect to an MCP server + wrap its tools
│   └── tool-sets.ts                  # launch the servers, assemble each agent's tools
└── lib/
    ├── session.ts                    # load / save the conversation (persistence)
    ├── format.ts                     # small helpers (error formatting, transcript)
    └── summary.ts                    # the /summary structured-output feature
```

Runtime data (`notes.json`, `session.json`) and `.env` are git-ignored.

## How it works

- **The agent loop.** Each turn is driven by the Claude SDK's tool runner (`client.beta.messages.toolRunner`). It sends the conversation plus the tool list, runs any tools Claude requests, feeds the results back, and repeats until Claude is done — all in [`agents/main/main-agent.ts`](src/agents/main/main-agent.ts).
- **Tools.** The `calculator` runs locally. Every other tool comes from an **MCP server**: [`tools/mcp.ts`](src/tools/mcp.ts) spawns the server, calls `listTools()`, and wraps each one so the tool runner can call it — the implementation lives in the server, not here.
- **Two MCP servers.** The third-party [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) (file tools) and the project's own [`sample-notes-mcp-server`](https://www.npmjs.com/package/sample-notes-mcp-server) (notes tools), launched identically in [`tools/tool-sets.ts`](src/tools/tool-sets.ts).
- **The sub-agent.** `ask_researcher` ([`agents/researcher/researcher-agent.ts`](src/agents/researcher/researcher-agent.ts)) runs a *separate* Claude conversation with its own prompt and its own tools, and returns its findings — to the main agent it's just another tool call.
- **Memory.** After every turn the full message history is written to `session.json` and reloaded on startup, so the agent resumes where it left off.

## Learning roadmap

Each stage added one concept; the git history has a commit per stage.

- [x] **Stage 0 — Hello Claude:** one-shot CLI, a single Messages API call
- [x] **Stage 1 — Chat loop:** multi-turn history + streaming + a resilient loop
- [x] **Stage 2 — First tools:** `calculator`, `read_file`, `write_file` (hand-written tool-use loop)
- [x] **Stage 3 — The agentic loop:** the same tools driven by the SDK tool runner
- [x] **Stage 4 — Structured output & polish:** `/summary` typed JSON; `/help`, `/reset`
- [x] **Stage 5 — Connect to MCP:** adopt file tools from the MCP filesystem server
- [x] **Stage 6 — Build your own MCP server:** a notes server used alongside it
- [x] **Stage 7 — Persistent memory across sessions:** save/resume via `session.json`
- [x] **Stage 8 — Coordinator agent:** `ask_researcher` delegates to a sub-agent
- [x] **Stage 9 — Package the notes server:** publish to npm and consume it as a dependency

## License

MIT
