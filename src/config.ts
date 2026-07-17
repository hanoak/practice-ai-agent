import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

// Shared configuration and the single Anthropic client used across the app.

export const client = new Anthropic({
  maxRetries: 5, // retry transient 429 / 5xx / 529 failures with backoff
});

// Model is env-configurable:  MODEL=claude-haiku-4-5 npm run dev
export const MODEL = process.env.MODEL ?? "claude-sonnet-5";

// Cap the tool-use loop so a misbehaving turn can't run away.
export const MAX_STEPS = 10;

// Where the conversation is persisted between runs.
export const SESSION_FILE = "session.json";

// The tools type our tool runner accepts (local + MCP-wrapped tools).
export type Tools = Parameters<typeof client.beta.messages.toolRunner>[0]["tools"];
