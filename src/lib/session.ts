import { readFile, writeFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { SESSION_FILE } from "../config";

// Persist the conversation between runs so restarting resumes where you left
// off. The saved history includes tool_use / tool_result blocks, so a resumed
// session is complete — not just a text summary.

export async function loadSession(): Promise<Anthropic.Beta.BetaMessageParam[]> {
  try {
    return JSON.parse(
      await readFile(SESSION_FILE, "utf8"),
    ) as Anthropic.Beta.BetaMessageParam[];
  } catch {
    return []; // no file yet, or unreadable → start fresh
  }
}

export async function saveSession(
  msgs: Anthropic.Beta.BetaMessageParam[],
): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(msgs, null, 2), "utf8");
}
