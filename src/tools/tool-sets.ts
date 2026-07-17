import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tools } from "../config";
import { calculator } from "./calculator";
import { adoptMcpServer } from "./mcp";
import { createResearcherTool } from "../agents/researcher/researcher-agent";

// Launch the MCP servers and assemble the tool set for each agent.
//   - researcher gets file + note tools (but NOT ask_researcher → no recursion)
//   - the main agent gets calculator + file + note tools + ask_researcher
export async function buildToolSets(): Promise<{
  mainTools: Tools;
  mcpClients: Client[];
}> {
  // Server 1: the third-party filesystem server (sandboxed to this directory).
  const filesystem = await adoptMcpServer("npx", [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    process.cwd(),
  ]);

  // Server 2: our own notes server — the PUBLISHED sample-notes-mcp-server
  // package (installed from npm), launched via npx with the notes-file path.
  const notes = await adoptMcpServer("npx", [
    "-y",
    "sample-notes-mcp-server",
    "notes.json",
  ]);

  const researcherTools: Tools = [...filesystem.tools, ...notes.tools];
  const askResearcher = createResearcherTool(researcherTools);

  const mainTools: Tools = [
    calculator,
    ...filesystem.tools,
    ...notes.tools,
    askResearcher,
  ];

  return { mainTools, mcpClients: [filesystem.mcp, notes.mcp] };
}
