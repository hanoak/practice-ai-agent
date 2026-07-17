import { stdout } from "node:process";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Collapse an MCP tool result into plain text for the tool runner.
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
// IMPLEMENTATIONS live in the server, not here. Works for any MCP server.
export async function adoptMcpServer(command: string, args: string[]) {
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
