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

## Run (Stage 2)

```bash
npm run dev
```

Chat with the agent — replies stream in and the conversation is remembered.
The agent now has tools: it can do math, read files, and write files. Try:

- `What is (2 + 3) * 7?` → uses the `calculator` tool
- `Write a haiku about the sea to poem.txt` → uses `write_file`
- `Read poem.txt and translate it to French` → uses `read_file`

Type `exit` or `quit` (or Ctrl+C) to leave. Switch models with
`MODEL=claude-haiku-4-5 npm run dev`.

## Roadmap

- [x] **Stage 0 — Hello Claude:** one-shot CLI, a single Messages API call.
- [x] **Stage 1 — Chat loop:** multi-turn conversation with history + streaming.
- [x] **Stage 2 — First tools:** `read_file`, `write_file`, `calculator` (manual tool-use loop).
- [ ] **Stage 3 — The agentic loop:** chain tool calls automatically (SDK tool runner).
- [ ] **Stage 4 — Structured output & polish:** typed JSON, error handling.
- [ ] **Stage 5 — Connect to MCP:** plug in an existing MCP server.
- [ ] **Stage 6 — Build your own MCP server:** expose your own tools over MCP.

Model: `claude-sonnet-5`.
