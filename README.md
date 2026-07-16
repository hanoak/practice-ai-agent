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

## Run (Stage 1)

```bash
npm run dev
```

Type a message and press Enter; the reply streams back token-by-token. The agent
remembers the conversation. Type `exit` or `quit` (or Ctrl+C) to leave.

## Roadmap

- [x] **Stage 0 — Hello Claude:** one-shot CLI, a single Messages API call.
- [x] **Stage 1 — Chat loop:** multi-turn conversation with history + streaming.
- [ ] **Stage 2 — First tools:** `read_file`, `write_file`, `calculator`.
- [ ] **Stage 3 — The agentic loop:** chain tool calls automatically (SDK tool runner).
- [ ] **Stage 4 — Structured output & polish:** typed JSON, error handling.
- [ ] **Stage 5 — Connect to MCP:** plug in an existing MCP server.
- [ ] **Stage 6 — Build your own MCP server:** expose your own tools over MCP.

Model: `claude-sonnet-5`.
