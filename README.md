# practice-ai-agent

A CLI personal-assistant agent, built stage by stage to learn AI agents, tool use, and MCP — using TypeScript, Node.js, and the Claude API.

## Setup

1. Install dependencies (already done if you're reading this after scaffolding):

   ```bash
   npm install
   ```

2. Add your API key:

   ```bash
   cp .env.example .env
   # then edit .env and paste your key from https://console.anthropic.com/settings/keys
   ```

## Run (Stage 9)

```bash
npm run dev
```

On startup the app launches **two MCP servers** as subprocesses and adopts their
tools: the third-party **filesystem** server (~14 file tools) and our own
[**`sample-notes-mcp-server`**](https://www.npmjs.com/package/sample-notes-mcp-server)
— published to npm and installed as a dependency (`add_note`, `list_notes`,
`search_notes`, `delete_note`). It also has a local `calculator`. The
conversation is saved to `session.json` and **resumed automatically on the next
run**. Try:

- `What is (2 + 3) * 7?` → local `calculator`
- `List the files here` → filesystem MCP server
- `Remember that I prefer TypeScript` then `What are my notes?` → notes MCP server
- Tell it your name, quit, re-run `npm run dev`, ask `What's my name?` → it remembers
- `Ask the researcher to summarize what this project does` → delegates to the researcher sub-agent

Commands: `/help`, `/tools`, `/summary`, `/reset`, `exit`/`quit`. Switch models
with `MODEL=claude-haiku-4-5 npm run dev`.

## Roadmap

- [x] **Stage 0 — Hello Claude:** one-shot CLI, a single Messages API call.
- [x] **Stage 1 — Chat loop:** multi-turn conversation with history + streaming.
- [x] **Stage 2 — First tools:** `read_file`, `write_file`, `calculator` (manual tool-use loop).
- [x] **Stage 3 — The agentic loop:** same tools, driven by the SDK tool runner (`betaZodTool` + `toolRunner`).
- [x] **Stage 4 — Structured output & polish:** `/summary` returns typed, schema-validated JSON; `/help` and `/reset` commands.
- [x] **Stage 5 — Connect to MCP:** adopt file tools from the official MCP filesystem server (client/server split).
- [x] **Stage 6 — Build your own MCP server:** a notes server the agent uses alongside the filesystem server.
- [x] **Stage 7 — Persistent memory across sessions:** the conversation is saved to `session.json` and resumed on restart.
- [x] **Stage 8 — Coordinator agent:** an `ask_researcher` tool delegates to a researcher sub-agent with its own prompt and tools.
- [x] **Stage 9 — Package the notes server:** published as [`sample-notes-mcp-server`](https://www.npmjs.com/package/sample-notes-mcp-server) on npm and consumed here as an installed dependency.

Model: `claude-sonnet-5`.
