import { readFile, writeFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Stage 6 — Your own MCP server
// This is a standalone MCP *server* exposing a tiny "notes" toolset. It knows
// nothing about Claude or our chat app — it just speaks MCP over stdio, so ANY
// MCP client can use it. Our agent (src/index.ts) launches it alongside the
// filesystem server. Notes persist in notes.json.
//   Run standalone (waits for MCP messages on stdin):  npm run server

const NOTES_FILE = "notes.json";

interface Note {
  id: number;
  text: string;
  createdAt: string;
}

async function loadNotes(): Promise<Note[]> {
  try {
    return JSON.parse(await readFile(NOTES_FILE, "utf8")) as Note[];
  } catch {
    return []; // file doesn't exist yet → no notes
  }
}

async function saveNotes(notes: Note[]): Promise<void> {
  await writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), "utf8");
}

const server = new McpServer({ name: "notes-server", version: "0.1.0" });

// Each registerTool call publishes one tool: a name, a description (the client's
// Claude reads this to decide when to call it), a Zod input schema, and the
// handler that runs on the server. This is the provider side of the exact same
// contract we consumed from the filesystem server in Stage 5.
server.registerTool(
  "add_note",
  {
    description: "Save a short text note for later. Returns the new note's id.",
    inputSchema: { text: z.string().describe("The note text to save.") },
  },
  async ({ text }) => {
    const notes = await loadNotes();
    const note: Note = {
      id: (notes.at(-1)?.id ?? 0) + 1,
      text,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    await saveNotes(notes);
    return { content: [{ type: "text", text: `Saved note #${note.id}.` }] };
  },
);

server.registerTool(
  "list_notes",
  { description: "List all saved notes." },
  async () => {
    const notes = await loadNotes();
    const text = notes.length
      ? notes.map((n) => `#${n.id} (${n.createdAt}): ${n.text}`).join("\n")
      : "No notes yet.";
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "search_notes",
  {
    description: "Find saved notes containing the given text (case-insensitive).",
    inputSchema: { query: z.string().describe("Substring to search for.") },
  },
  async ({ query }) => {
    const notes = await loadNotes();
    const matches = notes.filter((n) =>
      n.text.toLowerCase().includes(query.toLowerCase()),
    );
    const text = matches.length
      ? matches.map((n) => `#${n.id}: ${n.text}`).join("\n")
      : `No notes matching "${query}".`;
    return { content: [{ type: "text", text }] };
  },
);

// Connect over stdio and run until the client disconnects (stdin closes).
const transport = new StdioServerTransport();
await server.connect(transport);
