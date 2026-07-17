import { stdout } from "node:process";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fail } from "../lib/format";

// The one LOCAL tool (files come from MCP servers). Its run() executes in our
// process — the security boundary — so it whitelists its input.
export const calculator = betaZodTool({
  name: "calculator",
  description:
    "Evaluate a basic arithmetic expression. Use this for any math instead of " +
    "computing it yourself.",
  inputSchema: z.object({
    expression: z.string().describe("Arithmetic only, e.g. (2 + 3) * 7"),
  }),
  run: ({ expression }) => {
    stdout.write(`\n  ↳ calculator(${JSON.stringify({ expression })})`);
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return "Error: only numbers and + - * / ( ) . are allowed.";
    }
    try {
      return String(Function(`"use strict"; return (${expression});`)());
    } catch (err) {
      return fail(err);
    }
  },
});
