import { stdout } from "node:process";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { client, MODEL, MAX_STEPS, type Tools } from "../../config";
import { fail } from "../../lib/format";
import { RESEARCHER_SYSTEM_PROMPT } from "../../prompts/researcher";

// The researcher SUB-AGENT, exposed to the main agent as a single tool. When the
// main agent calls ask_researcher, we run a SEPARATE Claude conversation with
// its own system prompt and its own tools, and return its findings. To the main
// agent it looks like one tool call; under the hood it's a whole second agent.
//
// `researcherTools` are passed in (the file + note tools) — deliberately WITHOUT
// ask_researcher itself, so a researcher can't recursively delegate forever.
export function createResearcherTool(researcherTools: Tools) {
  return betaZodTool({
    name: "ask_researcher",
    description:
      "Delegate a question to a researcher sub-agent that can read files and " +
      "search notes. Use this for questions that require digging through the " +
      "project's files or the saved notes. Returns the researcher's findings.",
    inputSchema: z.object({
      question: z.string().describe("The research question for the sub-agent."),
    }),
    run: async ({ question }) => {
      stdout.write(`\n  ↳ ask_researcher(${JSON.stringify({ question })})`);
      try {
        // Awaiting the runner runs the sub-agent's whole tool-use loop to
        // completion and returns its final message.
        const finalMessage = await client.beta.messages.toolRunner({
          model: MODEL,
          max_tokens: 2048,
          system: RESEARCHER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: question }],
          tools: researcherTools,
          max_iterations: MAX_STEPS,
          stream: false,
        });
        let findings = "";
        for (const block of finalMessage.content) {
          if (block.type === "text") findings += block.text;
        }
        return findings.trim() || "(the researcher returned no findings)";
      } catch (err) {
        return fail(err);
      }
    },
  });
}
