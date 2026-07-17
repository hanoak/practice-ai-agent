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

## Run (Stage 5)

```bash
npm run dev
```

On startup the app launches the official **MCP filesystem server** as a
subprocess and adopts its ~14 file tools (read, write, list, search, …). It also
has a local `calculator`. Try:

- `What is (2 + 3) * 7?` → local `calculator` tool
- `List the files in this directory` → MCP `list_directory` tool
- `Write a haiku about the sea to poem.txt, then read it back` → MCP `write_file` + `read_file`

Commands: `/help`, `/tools` (list local + MCP tools), `/summary` (typed,
schema-validated summary), `/reset`, `exit`/`quit`. Switch models with
`MODEL=claude-haiku-4-5 npm run dev`.

## Roadmap

- [x] **Stage 0 — Hello Claude:** one-shot CLI, a single Messages API call.
- [x] **Stage 1 — Chat loop:** multi-turn conversation with history + streaming.
- [x] **Stage 2 — First tools:** `read_file`, `write_file`, `calculator` (manual tool-use loop).
- [x] **Stage 3 — The agentic loop:** same tools, driven by the SDK tool runner (`betaZodTool` + `toolRunner`).
- [x] **Stage 4 — Structured output & polish:** `/summary` returns typed, schema-validated JSON; `/help` and `/reset` commands.
- [x] **Stage 5 — Connect to MCP:** adopt file tools from the official MCP filesystem server (client/server split).
- [ ] **Stage 6 — Build your own MCP server:** expose your own tools over MCP.

Model: `claude-sonnet-5`.
