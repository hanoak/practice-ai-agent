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

## Run (Stage 6)

```bash
npm run dev
```

On startup the app launches **two MCP servers** as subprocesses and adopts their
tools: the third-party **filesystem** server (~14 file tools) and our own
**notes** server ([src/server.ts](src/server.ts): `add_note`, `list_notes`,
`search_notes`). It also has a local `calculator`. Try:

- `What is (2 + 3) * 7?` → local `calculator`
- `List the files here` → filesystem MCP server
- `Remember that I prefer TypeScript` then `What are my notes?` → notes MCP server

You can also run the notes server on its own (it waits for MCP messages on stdin):

```bash
npm run server
```

Commands: `/help`, `/tools`, `/summary`, `/reset`, `exit`/`quit`. Switch models
with `MODEL=claude-haiku-4-5 npm run dev`.

## Roadmap

- [x] **Stage 0 — Hello Claude:** one-shot CLI, a single Messages API call.
- [x] **Stage 1 — Chat loop:** multi-turn conversation with history + streaming.
- [x] **Stage 2 — First tools:** `read_file`, `write_file`, `calculator` (manual tool-use loop).
- [x] **Stage 3 — The agentic loop:** same tools, driven by the SDK tool runner (`betaZodTool` + `toolRunner`).
- [x] **Stage 4 — Structured output & polish:** `/summary` returns typed, schema-validated JSON; `/help` and `/reset` commands.
- [x] **Stage 5 — Connect to MCP:** adopt file tools from the official MCP filesystem server (client/server split).
- [x] **Stage 6 — Build your own MCP server:** a notes server (`src/server.ts`) the agent uses alongside the filesystem server.

Model: `claude-sonnet-5`.
